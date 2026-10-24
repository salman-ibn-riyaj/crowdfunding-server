import test from "node:test";
import assert from "node:assert/strict";
import {
    creditsToCents,
    validateCampaignCreateInput,
    validateCampaignUpdateInput,
    validateWithdrawalRequest,
} from "../src/creator/domain.js";

const now = Date.parse("2026-10-24T12:00:00.000Z");
const validCampaign = {
    title: "Help us build a solar-powered water pump",
    story: "Our village has no reliable water source during dry season. This project will build a solar-powered well and train local maintainers for it.",
    category: "Community",
    fundingGoal: 10000,
    minimumContribution: 5,
    deadline: "2027-01-15T00:00:00.000Z",
    rewardInfo: "Supporters receive project updates and an invitation to the opening.",
    imageUrl: "https://images.example.com/water-pump.jpg",
};

test("accepts a valid Creator campaign with credit-denominated amounts", () => {
    assert.deepEqual(validateCampaignCreateInput(validCampaign, now), {});
});

test("rejects invalid campaign amounts, deadlines, text, and image URLs", () => {
    const errors = validateCampaignCreateInput({
        ...validCampaign,
        title: "x",
        story: "short",
        fundingGoal: 10,
        minimumContribution: 11,
        deadline: "2026-10-24T12:00:00.000Z",
        imageUrl: "javascript:alert(1)",
    }, now);

    assert.ok(errors.title);
    assert.ok(errors.story);
    assert.ok(errors.minimumContribution);
    assert.ok(errors.deadline);
    assert.ok(errors.imageUrl);
});

test("campaign updates allow only title, story, and reward info", () => {
    const storedCampaign = { ...validCampaign, deadline: new Date(validCampaign.deadline) };
    assert.deepEqual(validateCampaignUpdateInput(storedCampaign, { title: "An updated community solar pump campaign" }, now), {});
    assert.ok(validateCampaignUpdateInput(validCampaign, { fundingGoal: 20000 }, now).patch);
    assert.ok(validateCampaignUpdateInput(validCampaign, {}, now).patch);
});

test("campaign update validates the changed field against its limits", () => {
    const errors = validateCampaignUpdateInput(validCampaign, { title: "bad" }, now);
    assert.ok(errors.title);
});

test("twenty credits convert to one dollar using integer cents", () => {
    assert.equal(creditsToCents(20), 100);
    assert.equal(creditsToCents(500), 2500);
    assert.throws(() => creditsToCents(1.5), RangeError);
});

test("withdrawal requires 200 earned credits but allows a smaller positive request", () => {
    assert.deepEqual(validateWithdrawalRequest({ earnedCredits: 200, availableCredits: 200, requestedCredits: 20 }), {});
    assert.ok(validateWithdrawalRequest({ earnedCredits: 199, availableCredits: 199, requestedCredits: 20 }).earnedCredits);
    assert.ok(validateWithdrawalRequest({ earnedCredits: 500, availableCredits: 100, requestedCredits: 101 }).requestedCredits);
    assert.ok(validateWithdrawalRequest({ earnedCredits: 500, availableCredits: 500, requestedCredits: 0 }).requestedCredits);
});