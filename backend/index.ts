import { ImageAnnotatorClient } from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { z } from 'zod';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { createExtractionChainFromZod } from 'langchain/chains';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { CacheBackedEmbeddings } from 'langchain/embeddings/cache_backed';
import { InMemoryStore } from 'langchain/storage/in_memory';
import { FaissStore } from 'langchain/vectorstores/faiss';
import { Document } from 'langchain/document';
import { JSONLoader } from 'langchain/document_loaders/fs/json';
import { format } from 'date-fns';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as PizZip from 'pizzip';
import * as DocxTemplater from 'docxtemplater';
import { lookup } from 'mime-types';

// Replace with your own API key.
const OPENAI_API_KEY = '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';

// Replace with your own google cloud project id, process location and processor id.
const projectId = '1059943768755';
const location = 'us';
const essayProcessorId = 'b23160dc2f2e52b3';
const formProcessorId = 'b6fc1624054856a2';

const essayFolderName = 'essays';
const formFolderName = 'forms';
const templateFolderName = 'templates';
const rawOcrOutputFolderName = 'ocr';
const langchainInputFolderName = 'slim';
const langchainIndividualOutputFileName = 'langchain-each.json';
const langchainMergedOutputFileName = 'langchain.json';

const rootPath = path.join(fileURLToPath(dirname(import.meta.url)), '..');

// Make sure service account json file is present at root directory to authenticate with google cloud.
const serviceAccountJsonPath = path.join(rootPath, 'service-account.json');

function copyFolderSync(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);

  files.forEach((file) => {
    const sourcePath = `${source}/${file}`;
    const targetPath = `${target}/${file}`;

    if (fs.statSync(sourcePath).isDirectory()) {
      copyFolderSync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

function generateHumanReadableDate(milliseconds: number) {
  const date = new Date(milliseconds);
  const dateFormat = 'yyyyMMdd_HHmmss';

  return format(date, dateFormat);
}

/**
 * Backup all source data to output directory.
 */
async function backupSourceFilesToOutputFolder({
  sourcePath,
  outputPath,
}: {
  sourcePath: string;
  outputPath: string;
}) {
  copyFolderSync(
    path.join(sourcePath, essayFolderName),
    path.join(outputPath, essayFolderName)
  );
  copyFolderSync(
    path.join(sourcePath, formFolderName),
    path.join(outputPath, formFolderName)
  );
  copyFolderSync(
    path.join(sourcePath, templateFolderName),
    path.join(outputPath, templateFolderName)
  );
}

/**
 * Note: Google document ai batch mode only support files stored in GCS.
 * Batch mode (current) support up to 200 pages per pdf.
 * Sync mode (not used, which supports direct upload and doesn't require GCS) support up to 10 pages per pdf.
 *
 * Steps:
 * - Upload all source files to GCS.
 * - Request OCR for all uploaded files.
 * - Download OCR result files from GCS to local data directory.
 * - Delete all uploaded and result files from GCS.
 */
async function googleOcr({
  outputPath,
  uid,
}: {
  outputPath: string;
  uid: string;
}) {
  const storage = new Storage({ keyFilename: serviceAccountJsonPath });
  const document = new DocumentProcessorServiceClient({
    keyFilename: serviceAccountJsonPath,
  });

  // Get all source data files from local directory.
  const essayFileNames = fs.readdirSync(path.join(outputPath, essayFolderName));
  const formFileNames = fs.readdirSync(path.join(outputPath, formFolderName));

  // Upload all source files to GCS.
  const bucketName = 'vision-ocr-source';
  const gcsInputPrefix = 'input';
  const gcsOutputPrefix = 'output';

  async function upload(fileName: string, prefix: string) {
    const sourceFilePath = path.join(outputPath, prefix, fileName);
    const destination = `${uid}/${gcsInputPrefix}/${prefix}/${fileName}`;

    await storage.bucket(bucketName).upload(sourceFilePath, {
      destination,
    });

    console.log(`File uploaded to ${destination}`);
  }

  console.log('Uploading to GCS');
  await Promise.all(
    [
      essayFileNames.map((fileName) => upload(fileName, essayFolderName)),
      formFileNames.map((fileName) => upload(fileName, formFolderName)),
    ].flat()
  );

  // Initiate ocr for all files.
  function process(
    fileNames: string[],
    type: 'essay' | 'form',
    prefix: string
  ) {
    if (fileNames.length === 0) {
      return;
    }

    return document.batchProcessDocuments({
      name: `projects/${projectId}/locations/${location}/processors/${
        type === 'essay' ? essayProcessorId : formProcessorId
      }`,
      inputDocuments: {
        gcsDocuments: {
          documents: fileNames.map((fileName) => {
            return {
              gcsUri: `gs://${bucketName}/${uid}/${gcsInputPrefix}/${prefix}/${fileName}`,
              mimeType: lookup(fileName).toString(),
            };
          }),
        },
      },
      documentOutputConfig: {
        gcsOutputConfig: {
          gcsUri: `gs://${bucketName}/${uid}/${gcsOutputPrefix}/${prefix}`,
        },
      },
    });
  }

  console.log('Initiating ocr');
  const [essayOperations, formOperations] = await Promise.all([
    process(essayFileNames, 'essay', essayFolderName),
    process(formFileNames, 'form', formFolderName),
  ]);

  console.log('Waiting for ocr to complete');
  await Promise.all([
    essayOperations ? essayOperations[0].promise() : undefined,
    formOperations ? formOperations[0].promise() : undefined,
  ]);

  // Download all OCR output files from GCS into local data directory.
  async function download(type: 'essay' | 'form', prefix: string) {
    const ocrOutputPath = path.join(outputPath, rawOcrOutputFolderName, prefix);
    fs.mkdirSync(ocrOutputPath, { recursive: true });

    const [files] = await storage
      .bucket(bucketName)
      .getFiles({ prefix: `${uid}/${gcsOutputPrefix}/${type}` });

    await Promise.all(
      files.map(async (file) => {
        const fileName = file.name.split('/').pop();
        const destination = path.join(ocrOutputPath, fileName ?? '');

        await file.download({ destination });

        console.log(`Downloaded: ${file.name} to ${destination}}`);
      })
    );
  }

  await Promise.all([
    download('essay', essayFolderName),
    download('form', formFolderName),
  ]);

  // Delete all uploaded and result files from GCS.
  await storage.bucket(bucketName).deleteFiles({ prefix: uid });
  console.log(`All files deleted successfully at gs://${bucketName}/${uid}`);
}

function removeFileExtension(fileName: string) {
  return fileName.split('.').slice(0, -1).join('.');
}

/**
 * Extract only relevant information from raw OCR output.
 * Essay will be written out as .txt, and form will be written out as .json.
 * Read all essay and form ocr result then output them into a single directory to simplify langchain document loading.
 */
function generateSlimOcrResult({
  alwaysTxt = true,
  outputPath,
}: {
  alwaysTxt?: boolean;
  outputPath: string;
}) {
  function generate(type: 'essay' | 'form', prefix: string) {
    const baseInputPath = path.join(outputPath, rawOcrOutputFolderName, prefix);
    const baseOutputPath = path.join(outputPath, langchainInputFolderName);

    fs.mkdirSync(baseOutputPath, { recursive: true });

    const sourceFiles = fs.readdirSync(baseInputPath);

    sourceFiles.forEach((fileName) => {
      const source = JSON.parse(
        fs.readFileSync(path.join(baseInputPath, fileName), 'utf-8')
      );

      // Essay pull out all texts into .txt
      if (type === 'essay') {
        const text = source.text;

        const outputFilePath = path.join(
          baseOutputPath,
          removeFileExtension(fileName) + '.txt'
        );
        fs.writeFileSync(outputFilePath, text);

        console.log(`Written to ${outputFilePath}`);
      }
      // Form pull out recognized entities into json.
      else {
        // Convert json into txt for better llm consumption.
        let txtOutput = '';

        // Result are grouped by pages.
        const jsonOutput = source.pages.map((page: any, i: number) => {
          let result = { page: i };

          // Named fields annotated by document ai.
          if (page.formFields) {
            page.formFields.forEach((field: any) => {
              if (field.fieldValue && field.fieldValue.textAnchor) {
                // @ts-expect-error
                result[field.fieldName.textAnchor.content.trim()] =
                  field.fieldValue.textAnchor.content.trim();

                txtOutput += `${field.fieldName.textAnchor.content
                  .trim()
                  .replace(/\n/g, '\\n')}: ${field.fieldValue.textAnchor.content
                  .trim()
                  .replace(/\n/g, '\\n')}\n`;
              }
            });
          }

          txtOutput += '\n';

          // Each page can contains multiple tables, present them in final result.
          if (page.tables) {
            page.tables.forEach((table: any, j: number) => {
              const allRows: [] = [];

              function process(rows: any[]) {
                if (!rows) {
                  return;
                }

                rows.forEach((headerRow: any) => {
                  allRows.push(
                    // @ts-expect-error
                    headerRow.cells.map((cell: any, k: number) => {
                      const segment = cell.layout.textAnchor.textSegments;

                      if (segment) {
                        const sourceText = source.text
                          .substring(segment[0].startIndex, segment[0].endIndex)
                          .trim();

                        txtOutput += `${k > 0 ? '|' : ''}${sourceText.replace(
                          /\n/g,
                          '\\n'
                        )}`;

                        return sourceText;
                      }

                      return '';
                    })
                  );
                  txtOutput += '\n';
                });
              }

              txtOutput += '\n';
              process(table.headerRows);
              process(table.bodyRows);

              // @ts-expect-error
              result[`table${j}`] = allRows;
            });
          }

          return result;
        });

        // Note: Disabled for now since it mainly contains duplicate data with field and tables.
        // General fields that are lumped together by document ai.
        // if (source.entities) {
        //   source.entities.forEach((entity: any, i: number) => {
        //     output[i].misc = entity.properties.map((property: any) => [
        //       property.type,
        //       property.mentionText,
        //     ]);
        //   });
        // }

        const outputFilePath = path.join(
          baseOutputPath,
          removeFileExtension(fileName) + (alwaysTxt ? '.txt' : '.json')
        );

        fs.writeFileSync(
          outputFilePath,
          alwaysTxt ? txtOutput : JSON.stringify(jsonOutput, null, 2)
        );

        console.log(`Written to ${outputFilePath}`);
      }
    });
  }

  generate('essay', essayFolderName);
  generate('form', formFolderName);
}

/**
 * Do not use embedding since bank statement etc embedding had a hard time retrieving the correct value.
 * Ask gpt one document at a time, then merge the result at the end.
 * One document at a time should be able to fit into gpt3.5 token limit.
 *
 * Adapted from:
 * https://js.langchain.com/docs/modules/chains/popular/structured_output
 * https://gist.github.com/horosin/5351ae4dc3eebbf181f9db212f5d3ebc
 */
async function extractFieldsFromOcrResult({
  outputPath,
}: {
  outputPath: string;
}) {
  const basePath = path.join(outputPath, langchainInputFolderName);
  const inputFiles = fs.readdirSync(basePath);

  // Assuming each file doesn't exceed 4096 gpt3.5 token limit, thus no further splitting is required.
  const docs: any[] = [];

  inputFiles.forEach((fileName) => {
    const content = fs.readFileSync(path.join(basePath, fileName), 'utf-8');
    docs.push(
      // If json remove formatting.
      fileName.endsWith('.txt') ? content : JSON.stringify(JSON.parse(content))
    );
  });

  // Generate embeddings for all documents, use cache whenever possible.
  // https://js.langchain.com/docs/modules/data_connection/text_embedding/how_to/caching_embeddings
  // const underlyingEmbeddings = new OpenAIEmbeddings({
  //   openAIApiKey: OPENAI_API_KEY,
  // });
  // const inMemoryStore = new InMemoryStore();

  //   const cacheBackedEmbeddings = CacheBackedEmbeddings.fromBytesStore(
  //     underlyingEmbeddings,
  //     inMemoryStore,
  //     {
  //       namespace: underlyingEmbeddings.modelName,
  //     }
  //   );

  //   const vectorStoreCreationTime = Date.now();
  //   const vectorStore = await FaissStore.fromDocuments(
  //     docs,
  //     cacheBackedEmbeddings
  //   );
  //   console.log(
  //     `Vector store creation time: ${Date.now() - vectorStoreCreationTime}ms`
  //   );

  const zodSchema = z.object({
    name: z.string().optional().describe('Name of the deceased'),
    address: z.string().optional().describe('Home address of the deceased'),
    age: z.number().optional().describe('Age of the deceased'),
    maritial_status: z
      .string()
      .optional()
      .describe('Maritial status of the deceased'),
    occupation: z.string().optional().describe('Occupation of the deceased'),
    identity_card: z
      .string()
      .optional()
      .describe('Identity card number of the deceased'),
    date_of_death: z
      .string()
      .optional()
      .describe('Date of death of the deceased'),
    cash: z.array(
      z.object({
        local_currency_amount: z
          .number()
          .optional()
          .describe('Amount of cash in local currency'),
        foreign_currency_amount: z
          .number()
          .optional()
          .describe('Amount of cash in foreign currency'),
      })
    ),
    bank_account: z.array(
      z.object({
        bank_name: z.string().optional().describe('Name of the bank'),
        account_number: z.string().optional().describe('Account number'),
        bank_balance_as_at_date_of_death_local_curency: z
          .number()
          .optional()
          .describe('Bank balance as at date of death in local currency'),
        bank_balance_as_at_date_of_death_foreign_currency: z
          .number()
          .optional()
          .describe('Bank balance as at date of death in foreign currency'),
      })
    ),
    safe_deposit_box: z.array(
      z.object({
        bank_name: z.string().optional().describe('Name of the bank'),
        box_number: z.string().optional().describe('Box number'),
        box_contents: z.string().optional().describe('Box contents'),
        branch: z.string().optional().describe('Bank branch'),
      })
    ),
    stock: z.array(
      z.object({
        own_name: z.object({
          holding: z.string().optional().describe('Holding'),
          name_of_company: z.string().optional().describe('Name of company'),
        }),
        security_account: z.object({
          holding: z.string().optional().describe('Holding'),
          name_of_company: z.string().optional().describe('Name of company'),
        }),
      })
    ),
    business: z.array(
      z.object({
        name: z.string().optional().describe('Name of business'),
        business_registration_number: z
          .string()
          .optional()
          .describe('Business registration number'),
        ownership_percentage: z
          .number()
          .optional()
          .describe('Ownership percentage'),
      })
    ),
    household_goods: z.array(
      z.object({
        description: z.string().optional().describe('Description'),
      })
    ),
    motor_vehicle: z.array(
      z.object({
        vehicle_registration_number: z
          .string()
          .optional()
          .describe('Vehicle registration number'),
        make: z.string().optional().describe('Make'),
        manufacture_year: z.string().optional().describe('Manufacture year'),
      })
    ),
    ship: z.array(
      z.object({
        vessel_class: z.string().optional().describe('Vessel class'),
        vessel_length: z.string().optional().describe('Vessel length'),
        vessel_registration_number: z
          .string()
          .optional()
          .describe('Vessel registration number'),
      })
    ),
    landed_property: z.array(
      z.object({
        address: z.string().optional().describe('Address'),
        description: z.string().optional().describe('Description'),
      })
    ),
    insurance_policy: z.array(
      z.object({
        policy_number: z.string().optional().describe('Policy number'),
        insurance_company: z.string().optional().describe('Insurance company'),
      })
    ),
    liabilities: z.array(
      z.object({
        creditor_name: z.string().optional().describe('Creditor name'),
        description: z.string().optional().describe('Description'),
      })
    ),
    will_written_at: z.string().optional().describe('Date of will written'),
    domicile: z.string().optional().describe('Domicile of the deceased'),
    deceased_made_and_executed_will_in_the_name_of: z
      .string()
      .optional()
      .describe('Deceased made and executed will in the name of'),
    deceased_held_assets_in_the_alias_of: z
      .string()
      .optional()
      .describe('Deceased held assets in the alias of'),
  });

  const model = new ChatOpenAI({
    modelName: 'gpt-3.5-turbo-16k',
    temperature: 0,
    openAIApiKey: OPENAI_API_KEY,
    verbose: true,
  });

  const responses: string[] = [];

  // Execute 1 by 1 to avoid hitting openai rate limit.
  for await (const doc of docs) {
    const chain = createExtractionChainFromZod(zodSchema, model);

    const response = await chain.run(
      typeof doc === 'string' ? doc : JSON.stringify(doc)
    );

    responses.push(response);
    console.log(JSON.stringify(response, null, 2));
  }

  // Save all individual GPT result inside a single json.
  const individualOutputPath = path.join(
    outputPath,
    langchainIndividualOutputFileName
  );

  fs.writeFileSync(individualOutputPath, JSON.stringify(responses, null, 2));
  console.log(`Langchain output saved to ${individualOutputPath}`);

  // Ask GPT again to merge all individual result into a single json.
  const chain = createExtractionChainFromZod(zodSchema, model);
  const mergedResponse = await chain.run(JSON.stringify(responses));

  const mergedOutputPath = path.join(outputPath, langchainMergedOutputFileName);
  fs.writeFileSync(mergedOutputPath, JSON.stringify(mergedResponse, null, 2));
  console.log(JSON.stringify(mergedResponse, null, 2));

  console.log(`Langchain output saved to ${mergedOutputPath}`);
}

async function runPythonLlamaLangchain() {}

/**
 * Read from template files, extract all template fields to be filled, then fill in the fields using langchain output.
 * Fields can be identified by {{field_name}}
 * For table, it will be {{[]|field_name1|field_name2|field_name3}}, and each matched
 */
async function fillInTemplate({ outputPath }: { outputPath: string }) {}

function setupNewRun() {
  const uid = '20230908_125219'; // generateHumanReadableDate(Date.now());
  const outputPath = path.join(rootPath, 'output', uid);

  // Create a new output directory for this run.
  fs.mkdirSync(outputPath, { recursive: true });

  console.log(`New run: ${uid} at ${outputPath}`);

  return { uid, outputPath };
}

export async function run() {
  const sourcePath = path.join(rootPath, 'source');
  console.log(`Loading source data from ${sourcePath}`);

  const { uid, outputPath } = setupNewRun();
  await backupSourceFilesToOutputFolder({ sourcePath, outputPath });
  await googleOcr({ outputPath, uid });
  generateSlimOcrResult({ outputPath });
  await extractFieldsFromOcrResult({ outputPath });
  await fillInTemplate({ outputPath });
}
