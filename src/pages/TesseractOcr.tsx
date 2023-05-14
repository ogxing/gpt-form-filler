import React from 'react';
import { createWorker } from 'tesseract.js';

interface TesseractOcrProps {
  file: File;
  onExtracted?: (text: string) => void;
}

const TesseractOcr: React.FC<TesseractOcrProps> = ({ file, onExtracted }) => {
  React.useEffect(() => {
    const extractText = async () => {
      const worker = await createWorker({
        logger: (m) => console.log(m),
      });

      try {
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        const {
          data: { text },
        } = await worker.recognize(file);
        if (onExtracted) {
          onExtracted(text);
        }
      } catch (error) {
        console.error('Error in text extraction:', error);
      } finally {
        await worker.terminate();
      }
    };

    extractText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, onExtracted]);

  return null;
};

export default TesseractOcr;