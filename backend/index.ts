import { ImageAnnotatorClient } from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';
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
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const OPENAI_API_KEY = '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';

const rootPath = path.join(fileURLToPath(dirname(import.meta.url)), '..');
const uid = Date.now().toString();

/**
 * Support image and pdf files.
 * Upload pdf files to GCS then start OCR and save the OCR result at local data directory.
 */
async function googleOcr(directoryPath: string) {
  const serviceAccountJsonPath = path.join(rootPath, 'service-account.json');

  const client = new ImageAnnotatorClient({
    keyFilename: serviceAccountJsonPath,
  });
  const storage = new Storage({ keyFilename: serviceAccountJsonPath });

  // Get all source data files from local directory.
  const sourceFiles = fs.readdirSync(directoryPath);

  const bucketName = 'vision-ocr-source';
  const filePrefix = `${bucketName}/${uid}`;

  const ocrOutputPath = path.join(rootPath, 'data', uid, 'ocr');
  fs.mkdirSync(ocrOutputPath, { recursive: true });

  await Promise.all(
    sourceFiles.map(async (fileName) => {
      if (fileName.toLowerCase().endsWith('.pdf')) {
        // Currently all PDF files must be uploaded to Google Cloud Storage before they can be processed.
        // https://cloud.google.com/vision/docs/pdf#document_text_detection_requests
        // Excerpt: Currently PDF/TIFF document detection is only available for files stored in Cloud Storage buckets. Response JSON files are similarly saved to a Cloud Storage bucket.
        const gcsSourceUri = `gs://${filePrefix}/input/${fileName}`;

        // Upload file to GCS.
        await storage
          .bucket(bucketName)
          .upload(path.join(directoryPath, fileName), {
            destination: `${uid}/input/${fileName}`,
          });
        console.log(`File uploaded to ${gcsSourceUri}`);

        // Start OCR.
        const [operation] = await client.asyncBatchAnnotateFiles({
          requests: [
            {
              inputConfig: {
                mimeType: 'application/pdf',
                gcsSource: {
                  uri: gcsSourceUri,
                },
              },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              outputConfig: {
                gcsDestination: {
                  uri: `gs://${filePrefix}/output/${removeFileExtension(
                    fileName
                  )}`,
                },
              },
            },
          ],
        });
        const [filesResponse] = await operation.promise();
      } else {
        // Image can be OCR-ed directly without uploading to GCS.
        const [result] = await client.textDetection(
          path.join(directoryPath, fileName)
        );
        fs.writeFileSync(
          path.join(ocrOutputPath, `${removeFileExtension(fileName)}.json`),
          JSON.stringify(result)
        );
      }
    })
  );

  // Download all OCR output files from GCS into local data directory.
  try {
    const [files] = await storage
      .bucket(bucketName)
      .getFiles({ prefix: `${uid}/output` });

    for (const file of files) {
      const fileName = file.name.split('/').pop();
      const destination = path.join(ocrOutputPath, `${fileName}`);

      await file.download({ destination });

      console.log(`Downloaded: ${file.name} to ${destination}}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }

  // Delete all uploaded and result files from GCS.
  await storage.bucket(bucketName).deleteFiles({ prefix: uid });
  console.log(`All files deleted successfully at gs://${filePrefix}`);
}

function removeFileExtension(fileName: string) {
  return fileName.split('.').slice(0, -1).join('.');
}

function generateSlimOcrResult(directoryPath: string) {
  const sourceFiles = fs.readdirSync(directoryPath);

  fs.mkdirSync(path.join(directoryPath, '..', 'slim'), { recursive: true });

  sourceFiles.forEach((fileName) => {
    const result = JSON.parse(
      fs.readFileSync(path.join(directoryPath, fileName), 'utf-8')
    );

    let output: any[] = [];

    // PDF ocr output.
    if (result.inputConfig) {
      // Extract text from each pages.
      result.responses.map((response: any) => {
        output.push({
          pageContent: response.fullTextAnnotation.text,
          metadata: {
            fileName,
            page: response.context.pageNumber,
            type: 'pdf',
          },
        });
      });
    }
    // Image ocr output
    else {
      output.push({
        pageContent: result.fullTextAnnotation.text,
        metadata: {
          fileName,
          type: 'image',
        },
      });
    }

    if (output) {
      fs.writeFileSync(
        path.join(directoryPath, '..', 'slim', fileName),
        JSON.stringify(output, null, 2)
      );
    }
  });
}

/**
 *
 * Adapted from:
 * https://js.langchain.com/docs/modules/chains/popular/structured_output
 * https://gist.github.com/horosin/5351ae4dc3eebbf181f9db212f5d3ebc
 */
async function extractFieldsFromOcrResult(directoryPath: string) {
  const sourceFiles = fs.readdirSync(directoryPath);

  // Load all OCR result json files into langchain document.
  // Assuming each pdf pages doesn't exceed 4096 gpt3.5 token limit, thus no further splitting is required.
  const docs: Document[] = [];

  sourceFiles.forEach((fileName) => {
    const result = JSON.parse(
      fs.readFileSync(path.join(directoryPath, fileName), 'utf-8')
    );

    // PDF ocr output.
    if (result.inputConfig) {
      // Extract text from each pages.
      result.responses.map((response: any) => {
        docs.push(
          new Document({
            pageContent: response.fullTextAnnotation.text,
            metadata: {
              fileName,
              page: response.context.pageNumber,
              type: 'pdf',
            },
          })
        );
      });
    }
    // Image ocr output
    else {
      docs.push(
        new Document({
          pageContent: result.fullTextAnnotation.text,
          metadata: {
            fileName,
            type: 'image',
          },
        })
      );
    }
  });

  // Generate embeddings for all documents, use cache whenever possible.
  // https://js.langchain.com/docs/modules/data_connection/text_embedding/how_to/caching_embeddings
  const underlyingEmbeddings = new OpenAIEmbeddings({
    openAIApiKey: OPENAI_API_KEY,
  });
  const inMemoryStore = new InMemoryStore();

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
    modelName: 'gpt-3.5-turbo',
    temperature: 0,
    openAIApiKey: OPENAI_API_KEY,
    verbose: true,
  });

  const chain = createExtractionChainFromZod(zodSchema, model);

  // Feed vector store into model.
  //   const vectorStoreRetriever = vectorStore.asRetriever();

  const response = await chain.run(JSON.stringify(docs));

  const parsedResponse = JSON.stringify(response, null, 2);

  console.log(parsedResponse);

  const outputPath = path.join(directoryPath, '..', 'langchain.json');
  fs.writeFileSync(outputPath, parsedResponse);
  console.log(`Langchain output saved to ${outputPath}`);
}

// googleOcr(path.join(rootPath, 'data', 'documents'));

// extractFieldsFromOcrResult(path.join(rootPath, 'data', '1693744562014', 'ocr'));

generateSlimOcrResult(path.join(rootPath, 'data', '1693744562014', 'ocr'));
