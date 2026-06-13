process.env.NODE_ENV = "test";

require("rootpath")();

const { isAllowedInviteUrl } = require("modules/remote/utils/inviteUrlValidation");

const FRONTENDS = "http://localhost:5173,https://serial.toolhub.app";

describe("isAllowedInviteUrl", () => {
  test("chấp nhận URL hợp lệ trong allowlist", () => {
    expect(
      isAllowedInviteUrl("https://serial.toolhub.app/?invite=abc", { frontendUrls: FRONTENDS })
    ).toBe(true);
    expect(
      isAllowedInviteUrl("http://localhost:5173/?invite=abc", { frontendUrls: FRONTENDS })
    ).toBe(true);
  });

  test("từ chối hostname lạ (open redirect)", () => {
    expect(
      isAllowedInviteUrl("https://evil.com/phish", { frontendUrls: FRONTENDS })
    ).toBe(false);
  });

  test("từ chối protocol không hợp lệ", () => {
    expect(
      isAllowedInviteUrl("javascript:alert(1)", { frontendUrls: FRONTENDS })
    ).toBe(false);
    expect(
      isAllowedInviteUrl("file:///etc/passwd", { frontendUrls: FRONTENDS })
    ).toBe(false);
  });

  test("từ chối URL malformed", () => {
    expect(isAllowedInviteUrl("not-a-url", { frontendUrls: FRONTENDS })).toBe(false);
  });

  test("bỏ qua entry FRONTEND_URLS không parse được", () => {
    expect(
      isAllowedInviteUrl("http://localhost:5173/x", {
        frontendUrls: "not-a-url,http://localhost:5173",
      })
    ).toBe(true);
  });
});
