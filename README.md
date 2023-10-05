POC to fill form from multiple sources using ChatGPT.

Steps:

- Extract required templates fields from docx.
- Read bank statement or any form based documents via Google Document AI into fields, and any essay like PDFs or images into block of texts via Google OCR.
- Feed the fields and essays to OpenAI to generate embeddings.
- Ask ChatGPT to extract all the fields mentioned in the template files.
- Fill in the template files with actual data returned by ChatGPT.

Setup:
Replace OpenAI and Google Document AI credentials with your own inside [backend/index.ts](backend/index.ts).
