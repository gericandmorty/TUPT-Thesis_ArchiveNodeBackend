const { GoogleGenerativeAI } = require('@google/generative-ai');

// Array of API keys from the environment variables
const apiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2
].filter(Boolean); // filter out any undefined keys

// Keep track of the current key index
let currentKeyIndex = 0;

/**
 * Gets a generative model using the current active API key.
 */
function getActiveModel(options = {}) {
    if (apiKeys.length === 0) {
        throw new Error("No Gemini API keys configured");
    }
    const currentKey = apiKeys[currentKeyIndex];
    const genAI = new GoogleGenerativeAI(currentKey);
    return genAI.getGenerativeModel({
        model: "models/gemini-2.5-flash",
        ...options
    });
}

/**
 * Generates text using the Gemini model, with automatic key rotation on failure.
 * @param {string} prompt - The prompt to send to the Gemini model.
 * @returns {Promise<string>} The generated text.
 */
async function generateText(prompt) {
    let attempts = 0;
    while (attempts < apiKeys.length) {
        try {
            const model = getActiveModel();
            console.log(`Using Gemini API Key index: ${currentKeyIndex}`);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            return text; // Success, return the text

        } catch (error) {
            console.error(`Error with key at index ${currentKeyIndex}:`, error.message);

            // Check if it's a quota or permission issue (often status 429 or 403)
            // For safety, we can just rotate on any error and try the next key
            attempts++;
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

            if (attempts >= apiKeys.length) {
                console.error("All Gemini API keys failed.");
                throw error; // Throw the last error if all keys fail
            } else {
                console.log(`Switching to next key at index: ${currentKeyIndex}`);
            }
        }
    }
}

/**
 * Generates JSON using the Gemini model, with automatic key rotation on failure.
 * @param {string} prompt - The prompt to send to the Gemini model.
 * @returns {Promise<string>} The generated JSON string.
 */
async function generateJson(prompt) {
    let attempts = 0;
    while (attempts < apiKeys.length) {
        try {
            const model = getActiveModel({
                generationConfig: { responseMimeType: "application/json" }
            });
            console.log(`Using Gemini API Key index: ${currentKeyIndex} for JSON generation`);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            return text; // Success, return the JSON string

        } catch (error) {
            console.error(`Error with key at index ${currentKeyIndex} during JSON generation:`, error.message);
            attempts++;
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

            if (attempts >= apiKeys.length) {
                console.error("All Gemini API keys failed for JSON generation.");
                throw error;
            } else {
                console.log(`Switching to next key at index: ${currentKeyIndex}`);
            }
        }
    }
}

/**
 * Generates JSON from multimodal data (e.g. PDF buffer) using Gemini, with key rotation.
 * @param {object} inlineData - Base64 inline file data object.
 * @param {string} prompt - The prompt for extraction rules.
 * @returns {Promise<string>} The generated JSON string.
 */
async function generateJsonFromMultimodal(inlineData, prompt) {
    let attempts = 0;
    while (attempts < apiKeys.length) {
        try {
            const model = getActiveModel({
                generationConfig: { responseMimeType: "application/json" }
            });
            console.log(`Using Gemini API Key index: ${currentKeyIndex} for Multimodal JSON generation`);

            const result = await model.generateContent([inlineData, prompt]);
            const response = await result.response;
            const text = response.text();

            return text; // Success, return the JSON string

        } catch (error) {
            console.error(`Error with key at index ${currentKeyIndex} during Multimodal JSON generation:`, error.message);
            attempts++;
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

            if (attempts >= apiKeys.length) {
                console.error("All Gemini API keys failed for Multimodal JSON generation.");
                throw error;
            } else {
                console.log(`Switching to next key at index: ${currentKeyIndex}`);
            }
        }
    }
}

module.exports = {
    generateText,
    generateJson,
    generateJsonFromMultimodal
};
