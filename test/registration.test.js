import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  assignRoleAndInitialCredits,
  INITIAL_CREDITS,
  OnboardingConflictError,
  validateRegistrationInput,
} from "../src/account/registration.js";

const validInput = {
  name: "Alex Example",
  email: "alex@example.com",
  image: "https://images.example.com/alex.png",
  password: "A-strong-pass-123",
};

test("accepts a valid registration profile and strong password", () => {
  assert.deepEqual(validateRegistrationInput(validInput), {});
});

test("reports malformed email, image URL, and weak password", () => {
  const errors = validateRegistrationInput({ ...validInput, email: "invalid", image: "javascript:alert(1)", password: "weak" });
  assert.ok(errors.email);
  assert.ok(errors.image);
  assert.ok(errors.password);
});

test("initial credit amounts are fixed by server-side role policy", () => {
  assert.deepEqual(INITIAL_CREDITS, { supporter: 50, creator: 20 });
});

test("public onboarding cannot assign the Admin role", async () => {
  await assert.rejects(
    assignRoleAndInitialCredits({}, new ObjectId().toString(), "admin"),
    /Choose either Supporter or Creator/,
  );
});

test("onboarding grants initial credits once and is idempotent for the same role", async () => {
  const id = new ObjectId();
  const user = { _id: id, role: "pending", credits: 0, roleOnboarded: false };
  const users = {
    async updateOne(filter, update) {
      if (!filter._id.equals(user._id) || user.roleOnboarded) return { modifiedCount: 0 };
      Object.assign(user, update.$set);
      return { modifiedCount: 1 };
    },
    async findOne(filter) {
      return filter._id.equals(user._id) ? user : null;
    },
  };

  assert.deepEqual(await assignRoleAndInitialCredits(users, id.toString(), "supporter"), {
    role: "supporter",
    credits: 50,
    roleOnboarded: true,
  });
  assert.deepEqual(await assignRoleAndInitialCredits(users, id.toString(), "supporter"), {
    role: "supporter",
    credits: 50,
    roleOnboarded: true,
  });
  assert.equal(user.credits, 50);
});

test("onboarding cannot change a role after the one-time grant", async () => {
  const id = new ObjectId();
  const user = { _id: id, role: "supporter", credits: 50, roleOnboarded: true };
  const users = {
    async updateOne() { return { modifiedCount: 0 }; },
    async findOne() { return user; },
  };

  await assert.rejects(
    assignRoleAndInitialCredits(users, id.toString(), "creator"),
    OnboardingConflictError,
  );
});