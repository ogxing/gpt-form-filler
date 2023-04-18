import React from 'react';

interface TemplateUploaderProps {
  onUpload?: (files: FileList) => void;
}

const TemplateUploader: React.FC<TemplateUploaderProps> = ({ onUpload }) => {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      if (onUpload) {
        onUpload(event.target.files);
      }
    }
  };

  return (
    <div className="col-span-full">
      <label htmlFor="pdf-upload" className="block text-lg font-medium leading-6 text-black text-center mb-2">
        Upload Templates {/* Update the label */}
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

export default TemplateUploader;