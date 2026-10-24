import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  archiveOrDeleteCampaign,
  createCampaign,
  createWithdrawalRequest,
  listPublicCampaigns,
  reviewContribution,
} from "../src/creator/service.js";

function createTransactionClient() {
  return {
    startSession() {
      return {
        async withTransaction(callback) { return callback(); },
        async endSession() {},
      };
    },
  };
}

function createDatabase(collections) {
  return { collection: (name) => collections[name] };
}

const now = new Date("2026-10-24T12:00:00.000Z");
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

test("new Creator campaigns are saved pending and are not pre-funded", async () => {
  let inserted;
  const database = createDatabase({
    campaign: { async insertOne(campaign) { inserted = campaign; return { insertedId: new ObjectId() }; } },
  });
  const ownerId = new ObjectId();
  const campaign = await createCampaign(database, {
    id: ownerId.toString(), role: "creator", email: "creator@example.com", name: "Creator",
  }, validCampaign, now);

  assert.equal(inserted.status, "pending");
  assert.equal(inserted.raisedCredits, 0);
  assert.equal(inserted.creatorId.toString(), ownerId.toString());
  assert.equal(campaign.lifecycle, "active");
});

test("public campaign listing filters to approved, active, unexpired campaigns", async () => {
  let query;
  const database = createDatabase({
    campaign: {
      find(filter) {
        query = filter;
        return { sort: () => ({ toArray: async () => [] }) };
      },
    },
  });
  await listPublicCampaigns(database, now);
  assert.equal(query.status, "approved");
  assert.equal(query.lifecycle, "active");
  assert.deepEqual(query.deadline, { $gt: now });
});

test("campaigns with contribution history are archived rather than deleted", async () => {
  const campaignId = new ObjectId();
  const ownerId = new ObjectId();
  const campaign = { _id: campaignId, creatorId: ownerId, lifecycle: "active" };
  let deleted = false;
  const database = createDatabase({
    campaign: {
      async findOne() { return campaign; },
      async updateOne(_filter, update) { Object.assign(campaign, update.$set); return { modifiedCount: 1 }; },
      async deleteOne() { deleted = true; },
    },
    contribution: { async countDocuments() { return 1; } },
  });

  const result = await archiveOrDeleteCampaign(database, createTransactionClient(), {
    id: ownerId.toString(),
    role: "creator",
  }, campaignId.toString(), now);

  assert.deepEqual(result, { deleted: false, lifecycle: "archived" });
  assert.equal(campaign.lifecycle, "archived");
  assert.equal(deleted, false);
});

test("campaigns with no contribution history are permanently deleted", async () => {
  const campaignId = new ObjectId();
  const ownerId = new ObjectId();
  let deleted = false;
  const database = createDatabase({
    campaign: {
      async findOne() { return { _id: campaignId, creatorId: ownerId }; },
      async deleteOne() { deleted = true; },
      async updateOne() { assert.fail("Campaign without history should not be archived."); },
    },
    contribution: { async countDocuments() { return 0; } },
  });

  const result = await archiveOrDeleteCampaign(database, createTransactionClient(), {
    id: ownerId.toString(),
    role: "creator",
  }, campaignId.toString(), now);

  assert.deepEqual(result, { deleted: true });
  assert.equal(deleted, true);
});

test("approving a pending contribution updates campaign and payout balance once", async () => {
  const ownerId = new ObjectId();
  const campaignId = new ObjectId();
  const contributionId = new ObjectId();
  const supporterId = new ObjectId();
  const campaign = { _id: campaignId, creatorId: ownerId, raisedCredits: 40, pendingCredits: 10, fundingGoal: 100, lifecycle: "active" };
  const contribution = { _id: contributionId, campaignId, creatorId: ownerId, supporterId, amountCredits: 10, status: "pending" };
  const creator = { totalEarnedCredits: 0, payoutBalanceCredits: 0 };
  const database = createDatabase({
    contribution: {
      async findOne() { return contribution.status === "pending" ? contribution : null; },
      async updateOne(filter, update) {
        if (contribution.status !== filter.status) return { modifiedCount: 0 };
        Object.assign(contribution, update.$set);
        return { modifiedCount: 1 };
      },
    },
    campaign: {
      async findOne() { return campaign; },
      async updateOne(_filter, update) {
        for (const [key, amount] of Object.entries(update.$inc)) campaign[key] += amount;
        Object.assign(campaign, update.$set);
        return { modifiedCount: 1 };
      },
    },
    user: {
      async updateOne(_filter, update) {
        for (const [key, amount] of Object.entries(update.$inc)) creator[key] += amount;
        return { modifiedCount: 1 };
      },
    },
  });

  const actor = { id: ownerId.toString(), role: "creator" };
  const first = await reviewContribution(database, createTransactionClient(), actor, contributionId.toString(), "approve", now);
  assert.equal(first.status, "approved");
  assert.equal(campaign.raisedCredits, 50);
  assert.equal(campaign.pendingCredits, 0);
  assert.equal(creator.totalEarnedCredits, 10);
  assert.equal(creator.payoutBalanceCredits, 10);
  await assert.rejects(
    reviewContribution(database, createTransactionClient(), actor, contributionId.toString(), "approve", now),
    /no longer pending/,
  );
  assert.equal(creator.totalEarnedCredits, 10);
});

test("rejecting a pending contribution refunds the supporter once", async () => {
  const ownerId = new ObjectId();
  const campaignId = new ObjectId();
  const contributionId = new ObjectId();
  const supporterId = new ObjectId();
  const campaign = { _id: campaignId, creatorId: ownerId, pendingCredits: 12, raisedCredits: 0, fundingGoal: 100, lifecycle: "active" };
  const contribution = { _id: contributionId, campaignId, creatorId: ownerId, supporterId, amountCredits: 12, status: "pending" };
  const supporter = { credits: 4 };
  const database = createDatabase({
    contribution: {
      async findOne() { return contribution.status === "pending" ? contribution : null; },
      async updateOne(_filter, update) { Object.assign(contribution, update.$set); return { modifiedCount: 1 }; },
    },
    campaign: {
      async findOne() { return campaign; },
      async updateOne(_filter, update) {
        for (const [key, amount] of Object.entries(update.$inc)) campaign[key] += amount;
        return { modifiedCount: 1 };
      },
    },
    user: {
      async updateOne(_filter, update) {
        for (const [key, amount] of Object.entries(update.$inc)) supporter[key] += amount;
        return { modifiedCount: 1 };
      },
    },
  });

  const actor = { id: ownerId.toString(), role: "creator" };
  await reviewContribution(database, createTransactionClient(), actor, contributionId.toString(), "reject", now);
  assert.equal(contribution.status, "rejected");
  assert.equal(campaign.pendingCredits, 0);
  assert.equal(supporter.credits, 16);
  await assert.rejects(
    reviewContribution(database, createTransactionClient(), actor, contributionId.toString(), "reject", now),
    /no longer pending/,
  );
  assert.equal(supporter.credits, 16);
});

test("withdrawal request reserves credits and stores the 20-to-1 dollar amount", async () => {
  const ownerId = new ObjectId();
  const creator = { _id: ownerId, role: "creator", email: "creator@example.com", name: "Creator", totalEarnedCredits: 400, payoutBalanceCredits: 350, pendingWithdrawalCredits: 0 };
  let inserted;
  const database = createDatabase({
    user: {
      async findOne() { return creator; },
      async updateOne(filter, update) {
        if (creator.payoutBalanceCredits < filter.payoutBalanceCredits.$gte) return { modifiedCount: 0 };
        for (const [key, amount] of Object.entries(update.$inc)) creator[key] += amount;
        return { modifiedCount: 1 };
      },
    },
    withdrawal: {
      async insertOne(document) { inserted = document; return { insertedId: new ObjectId() }; },
    },
  });

  const withdrawal = await createWithdrawalRequest(database, createTransactionClient(), {
    id: ownerId.toString(),
    role: "creator",
  }, { creditsToWithdraw: 100, paymentSystem: "Bkash", accountNumber: "01712345678" }, now);

  assert.equal(withdrawal.withdrawalAmountCents, 500);
  assert.equal(inserted.status, "pending");
  assert.equal(creator.payoutBalanceCredits, 250);
  assert.equal(creator.pendingWithdrawalCredits, 100);
});