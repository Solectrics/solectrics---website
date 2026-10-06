import test from "node:test";
import assert from "node:assert/strict";
import { accessIdentityFromRequest, parseAccessJwtPayload, selectBusinessContext } from "../functions/api/business-context.js";

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({alg:"none"})}.${encode(payload)}.${encode("sig")}`;
}

test("Cloudflare identity requires both Access email and assertion subject", () => {
  const request = new Request("https://example.test", {headers:{
    "cf-access-authenticated-user-email":"Jane@Example.com",
    "cf-access-jwt-assertion":jwt({sub:"user-123", email:"jane@example.com"})
  }});
  assert.deepEqual(accessIdentityFromRequest(request), {
    provider:"cloudflare_access",
    provider_subject:"user-123",
    email:"jane@example.com",
    email_verified:true
  });
});

test("mismatched JWT email is rejected", () => {
  const request = new Request("https://example.test", {headers:{
    "cf-access-authenticated-user-email":"jane@example.com",
    "cf-access-jwt-assertion":jwt({sub:"user-123", email:"other@example.com"})
  }});
  assert.equal(accessIdentityFromRequest(request), null);
});

test("business context selects explicit business or sole membership", () => {
  const businesses = [{id:"solectrics",slug:"solectrics"},{id:"espresso",slug:"sol-espresso"}];
  assert.equal(selectBusinessContext(businesses, "espresso").id, "espresso");
  assert.equal(selectBusinessContext(businesses, "sol-espresso").id, "espresso");
  assert.equal(selectBusinessContext(businesses, ""), null);
  assert.equal(selectBusinessContext([businesses[0]], "").id, "solectrics");
});

test("JWT parser rejects malformed assertions", () => {
  assert.equal(parseAccessJwtPayload("not-a-jwt"), null);
});
