import React, { useState } from 'react';
import SummaryList from './SummaryList';
import PDFUploader from './PDFUploader'; // Adjust the import path if necessary
import TemplateUploader from './TemplateUploader'; // Import the TemplateUploader component

const Home: React.FC = () => {
  const [summaries, setSummaries] = useState<string[]>([]);

  const handleUpload = (files: FileList) => {
    console.log('Uploaded files:', files);
  };

  const handleExtract = (extractedSummaries: string[]) => {
    setSummaries(extractedSummaries);
  };

  const profilePictureSrc = './profile.webp';

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-24 bg-gray-100">
      <svg className="w-32 h-32 mb-4" viewBox="0 0 128 128">
        <defs>
          <pattern id="profile-picture" patternUnits="userSpaceOnUse" width="150" height="150">
            <image href={profilePictureSrc} width="128" height="150" />
          </pattern>
        </defs>
        <circle cx="64" cy="64" r="64" fill="url(#profile-picture)" />
      </svg>
      <h1 className="text-4xl font-semibold text-center text-black w-full mb-12">Justice Bao 包拯</h1>
      <div className="flex flex-wrap justify-center gap-8">
        <PDFUploader onUpload={handleUpload} onExtract={handleExtract} />
        <TemplateUploader onUpload={handleUpload} /> {/* Use the TemplateUploader component */}
      </div>
      <button
        className="mt-8 px-6 py-3 bg-blue-500 text-white font-semibold rounded"
        //onClick={processFiles}
      >
        Process Files
      </button>
      <SummaryList summaries={summaries} />
    </div>
  );
};

export default Home;