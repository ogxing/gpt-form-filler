import React, { useState } from 'react';
import fileDownload from 'js-file-download';
import SummaryList from './SummaryList';
import PDFUploader from './PDFUploader'; // Adjust the import path if necessary
import TemplateUploader from './TemplateUploader'; // Import the TemplateUploader component

const Home: React.FC = () => {
  const [summaries, setSummaries] = useState<string[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);

  const handlePdfUpload = (files: FileList) => {
    setPdf(files[0]);
  };
  const handleTemplateUpload = (files: FileList) => {
    setTemplate(files[0]);
  };

  const handleExtract = (extractedSummaries: string[]) => {
    setSummaries(extractedSummaries);
  };

  const handleProcessFile = async () => {
    if (!pdf) {
      return alert('Please select a pdf file');
    }
    if (!template) {
      return alert('Please select a template file');
    }

    async function processFile(file: File) {
      return new Promise<{ name: string; content: string }>(
        (resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () =>
            resolve({
              name: file.name,
              content: reader.result as string,
            });
          reader.onerror = reject;
        }
      );
    }

    try {
      setProcessing(true);

      const [pdfContent, templateContent] = await Promise.all([
        processFile(pdf),
        processFile(template),
      ]);

      const response = await fetch('http://localhost:8888/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ essay: pdfContent, template: templateContent }),
      });

      // Trigger file download from local data.
      if (response.ok) {
        const resultUrls = (await response.json()) as {
          name: string;
          url: string;
        }[];
        await Promise.all(
          resultUrls.map(async (result) => {
            fileDownload(await (await fetch(result.url)).blob(), result.name);
          })
        );
      } else {
        alert('Something went wrong');
      }
    } finally {
      setProcessing(false);
    }
  };

  const profilePictureSrc = './profile.webp';

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-24 bg-gray-100">
      <svg className="w-32 h-32 mb-4" viewBox="0 0 128 128">
        <defs>
          <pattern
            id="profile-picture"
            patternUnits="userSpaceOnUse"
            width="150"
            height="150"
          >
            <image href={profilePictureSrc} width="128" height="150" />
          </pattern>
        </defs>
        <circle cx="64" cy="64" r="64" fill="url(#profile-picture)" />
      </svg>
      <h1 className="text-4xl font-semibold text-center text-black w-full mb-12">
        Justice Bao 包拯
      </h1>
      <div className="flex flex-wrap justify-center gap-8">
        <PDFUploader onExtract={handleExtract} onUpload={handlePdfUpload} />
        <TemplateUploader onUpload={handleTemplateUpload} />
        {/* Use the TemplateUploader component */}
      </div>
      <button
        className="mt-8 px-6 py-3 bg-blue-500 text-white font-semibold rounded"
        onClick={handleProcessFile}
        disabled={processing}
      >
        {processing ? 'Processing' : 'Process Files'}
      </button>
      <SummaryList summaries={summaries} />
    </div>
  );
};

export default Home;
