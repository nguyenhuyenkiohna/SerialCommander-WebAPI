require("../configs/bootstrapEnv").loadEnvFiles();
require("rootpath")();
const {
  User,
  PasswordReset,
  EmailVerificationCode,
  Scenario,
  UserActivity,
} = require("../models");

async function deleteUser() {
  const args = process.argv.slice(2).filter((a) => a !== "--yes");
  const autoYes = process.argv.includes("--yes");
  const identifier = args[0];

  if (!identifier) {
    console.log("Usage: node scripts/delete_user.js <username|email|id> [--yes]");
    process.exit(1);
  }

  console.log(`🔍 Đang tìm user: "${identifier}"...\n`);

  let user;
  if (!Number.isNaN(Number(identifier)) && String(Number(identifier)) === identifier) {
    user = await User.findByPk(identifier);
  } else if (identifier.includes("@")) {
    user = await User.findOne({ where: { email: identifier } });
  } else {
    user = await User.findOne({ where: { username: identifier } });
  }

  if (!user) {
    console.log(`❌ Không tìm thấy user: "${identifier}"`);
    process.exit(1);
  }

  console.log("📋 User sẽ xóa:");
  console.log(`   id=${user.id} username=${user.username || "(null)"} email=${user.email} provider=${user.provider || "local"}\n`);

  const runDelete = async () => {
    const uid = user.id;
    const email = user.email;

    const [resets, codes, scenarios, activities] = await Promise.all([
      PasswordReset.destroy({ where: { UserId: uid } }),
      EmailVerificationCode.destroy({ where: { UserId: uid } }),
      Scenario.destroy({ where: { UserId: uid } }),
      UserActivity.destroy({ where: { UserId: uid } }),
    ]);
    const resetsByEmail = await PasswordReset.destroy({ where: { email } });

    await user.destroy();

    console.log(`✅ Đã xóa user id=${uid} (${email})`);
    console.log(`   PasswordReset: ${resets + resetsByEmail}, EmailVerificationCode: ${codes}, Scenario: ${scenarios}, UserActivity: ${activities}`);
  };

  if (autoYes) {
    await runDelete();
    process.exit(0);
  }

  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("⚠️  Xóa user này? (yes/no): ", async (answer) => {
    try {
      if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
        console.log("❌ Đã hủy.");
        process.exit(0);
      }
      await runDelete();
      process.exit(0);
    } catch (error) {
      console.error("❌ Lỗi:", error.message);
      process.exit(1);
    } finally {
      rl.close();
    }
  });
}

deleteUser().catch((e) => {
  console.error("❌ Lỗi:", e.message);
  process.exit(1);
});
