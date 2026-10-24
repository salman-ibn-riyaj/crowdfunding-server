import FormData from "form-data";
import { config } from "../config.js";

/**
 * Uploads an image to imgBB using base64 data.
 * @param {string} base64Data - Base64 encoded image data (without data URL prefix)
 * @returns {Promise<{ url: string, deleteUrl?: string }>}
 */
export async function uploadToImgBB(base64Data) {
    if (!config.imgbbApiKey) {
        throw new Error("IMGBB_API_KEY is not configured");
    }

    const formData = new FormData();
    formData.append("image", base64Data);

    const response = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: formData,
        headers: {
            ...formData.getHeaders(),
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`imgBB upload failed: ${response.status} ${error}`);
    }

    const result = await response.json();

    if (!result.success) {
        throw new Error(`imgBB upload failed: ${result.error?.message || "Unknown error"}`);
    }

    return {
        url: result.data.url,
        deleteUrl: result.data.delete_url,
    };
}

/**
 * Validates if a string is a valid HTTP/HTTPS URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidImageUrl(url) {
    try {
        const parsed = new URL(url);
        return ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}
