process.env.NODE_ENV = "test";

require("rootpath")();

jest.mock("models", () => ({
  UserActivity: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findAll: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    destroy: jest.fn(),
  },
}));

const { UserActivity } = require("models");
const UserActivityService = require("./userActivityService");

describe("userActivityService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("createActivity serializes metadata", async () => {
    UserActivity.create.mockResolvedValue({ id: 1 });
    await UserActivityService.createActivity(1, "LOGIN", "ok", { ip: "1.1.1.1" });
    expect(UserActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        Metadata: JSON.stringify({ ip: "1.1.1.1" }),
      })
    );
  });

  test("getUserActivities parses metadata JSON", async () => {
    UserActivity.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [
        {
          toJSON: () => ({ Metadata: "{\"foo\":1}" }),
        },
      ],
    });
    const out = await UserActivityService.getUserActivities(1);
    expect(out.activities[0].Metadata).toEqual({ foo: 1 });
  });
});
