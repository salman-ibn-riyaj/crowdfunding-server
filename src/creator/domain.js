const CAMPAIGN_UPDATE_FIELDS = new Set(["title", "story", "rewardInfo"]);
const MAX_CREDITS = 1_000_000_000;

function validText(value, minLength, maxLength) {
    return typeof value === "string" && value.trim().length >= minLength && value.trim().length <= maxLength;
}

function validCredits(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_CREDITS;
}

function validImageUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function validateCampaignFields(input, now = Date.now()) {
    const errors = {};

    if (!validText(input.title, 8, 120)) {
        errors.title = "Title must be between 8 and 120 characters.";
    }
    if (!validText(input.story, 40, 12000)) {
        errors.story = "Campaign story must be between 40 and 12,000 characters.";
    }
    if (!validText(input.category, 2, 60)) {
        errors.category = "Choose a category between 2 and 60 characters.";
    }
    if (!validCredits(input.fundingGoal)) {
        errors.fundingGoal = "Funding goal must be a positive whole number of credits.";
    }
    if (!validCredits(input.minimumContribution)) {
        errors.minimumContribution = "Minimum contribution must be a positive whole number of credits.";
    }
    if (
        validCredits(input.fundingGoal) &&
        validCredits(input.minimumContribution) &&
        input.minimumContribution > input.fundingGoal
    ) {
        errors.minimumContribution = "Minimum contribution cannot exceed the funding goal.";
    }

    const deadline = input.deadline instanceof Date
        ? input.deadline.getTime()
        : typeof input.deadline === "string"
            ? Date.parse(input.deadline)
            : NaN;
    if (!Number.isFinite(deadline) || deadline <= now) {
        errors.deadline = "Choose a valid future deadline.";
    }
    if (!validText(input.rewardInfo, 2, 2000)) {
        errors.rewardInfo = "Reward information must be between 2 and 2,000 characters.";
    }
    if (!validImageUrl(input.imageUrl)) {
        errors.imageUrl = "Enter a valid HTTP or HTTPS campaign image URL.";
    }

    return errors;
}

export function validateCampaignCreateInput(input = {}, now = Date.now()) {
    return validateCampaignFields(input, now);
}

export function validateCampaignUpdateInput(existing, patch, now = Date.now()) {
    const errors = {};
    const fields = Object.keys(patch || {});
    if (fields.length === 0) return { patch: "Provide at least one field to update." };
    if (fields.some((field) => !CAMPAIGN_UPDATE_FIELDS.has(field))) {
        return { patch: "Only title, story, and reward information can be updated." };
    }

    const merged = { ...existing, ...patch };
    const fieldErrors = validateCampaignFields(merged, now);
    for (const field of ["title", "story", "rewardInfo"]) {
        if (Object.hasOwn(patch, field) && fieldErrors[field]) errors[field] = fieldErrors[field];
    }
    return errors;
}

export function creditsToCents(credits) {
    if (!Number.isSafeInteger(credits) || credits < 0 || credits > MAX_CREDITS) {
        throw new RangeError("Credits must be a non-negative whole number within the supported limit.");
    }
    return credits * 5;
}

export function validateWithdrawalRequest({ earnedCredits, availableCredits, requestedCredits } = {}) {
    const errors = {};

    if (!Number.isSafeInteger(earnedCredits) || earnedCredits < 200) {
        errors.earnedCredits = "You need at least 200 earned credits before requesting a withdrawal.";
    }
    if (!Number.isSafeInteger(requestedCredits) || requestedCredits <= 0) {
        errors.requestedCredits = "Enter a positive whole number of credits.";
    } else if (!Number.isSafeInteger(availableCredits) || requestedCredits > availableCredits) {
        errors.requestedCredits = "Requested credits exceed your available payout balance.";
    }

    return errors;
}