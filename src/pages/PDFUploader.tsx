import React from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PDFUploaderProps {
  onExtract?: (texts: string[]) => void;
}

const PDFUploader: React.FC<PDFUploaderProps> = ({ onExtract }) => {
  const processPdfFile = async (file: File): Promise<string | null> => {
    // ... PDF processing logic here ... concatenate text from several pages and documents and return it as a json object
  };

  const summarizeText = async (text: string): Promise<string | null> => {
    // ... GPT summarization logic here: call GPT API and return the summary of the json objects with extractect information such as birth date, name, etc.
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const extractedTexts: string[] = [];

      for (let i = 0; i < event.target.files.length; i++) {
        const file = event.target.files[i];
        const extractedText = await processPdfFile(file);
        if (extractedText) {
          extractedTexts.push(extractedText);
        }
      }

      if (onExtract) {
        onExtract(extractedTexts);
      }
    }
  };

  return (
    <div className="col-span-full">
      <label htmlFor="pdf-upload" className="block text-lg font-medium leading-6 text-black text-center mb-2">
        Upload PDF Documents {/* Update the label */}
      </label>
      <div className="w-64 h-64 mt-2 flex items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-100 shadow-lg">
        <div className="text-center">
        <div className="flex items-center justify-center text-sm leading-6 text-gray-400">
            <label
              htmlFor="pdf-upload"
              className="relative cursor-pointer rounded-md bg-blue-500 font-semibold text-white py-1 px-4 text-lg focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2 focus-within:ring-offset-blue-100 hover:text-blue-300"
            >
              <span>Upload</span>
              <input id="pdf-upload" name="pdf-upload" type="file" accept=".pdf" multiple onChange={handleFileChange} className="sr-only" />
            </label>
          </div>
          <p className="text-xs leading-10 text-gray-400">or drag and drop PDF files up to 10MB</p> {/* Update the file type and size */}
        </div>
      </div>
    </div>
  );
};

export default PDFUploader;