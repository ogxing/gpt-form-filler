import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
    apiKey: "your_api_key_here",
});
const openaiClient = new OpenAIApi(configuration);

export const summarizeWithChatGPT = async (text: string): Promise<string | null> => {
    try {
        const response = await openaiClient.createCompletion({
            model: "gpt-3.5-turbo",
            prompt: `Please summarize the following text and extract key information and relations in as little tokens as possible:\n\n${text}`,
            temperature: 0.7,
            max_tokens: 50,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        });

        if (response.data.choices?.length > 0) {
            return response.data.choices[0].text.trim();
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error calling ChatGPT API:", error);
        return null;
    }
};