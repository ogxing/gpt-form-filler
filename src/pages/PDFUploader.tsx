import React, { useState } from 'react';
import TesseractOcr from './TesseractOcr';
import { summarizeWithChatGPT as gptSummarizeText } from './gptHelpers';

interface PDFUploaderProps {
  onExtract?: (texts: string[]) => void;
}

const PDFUploader: React.FC<PDFUploaderProps> = ({ onExtract }) => {
  const [processingFiles, setProcessingFiles] = useState<File[]>([]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setProcessingFiles(Array.from(event.target.files));
    }
  };

  const handleExtractedText = async (text: string, index: number) => {
    const summary = await gptSummarizeText(text);
    if (summary !== null && onExtract) {
      onExtract([summary]);
    }
  
    // Remove the processed file from the processingFiles array
    setProcessingFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
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
      {processingFiles.map((file, index) => (
        <TesseractOcr key={index} file={file} onExtracted={(text) => handleExtractedText(text, index)} />
      ))}
    </div>
  );
};

export default PDFUploader;