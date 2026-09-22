import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const retryModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/ai-retry.js")));
const agentModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron/electron/server/agent.js")));

{
  let attempts = 0;
  const received = [];
  for await (const chunk of retryModule.streamWithAiRequestRetries(async function* () {
    attempts += 1;
    if (attempts === 1) throw new Error("failed before first chunk");
    yield "a";
    yield "b";
  }, { maxRetries: 1 })) {
    received.push(chunk);
  }
  assert.deepEqual(received, ["a", "b"]);
  assert.equal(attempts, 2);
}

{
  let attempts = 0;
  const received = [];
  await assert.rejects(async () => {
    for await (const chunk of retryModule.streamWithAiRequestRetries(async function* () {
      attempts += 1;
      yield "first";
      throw new Error("failed after output");
    }, { maxRetries: 2 })) {
      received.push(chunk);
    }
  }, /failed after output/);
  assert.deepEqual(received, ["first"]);
  assert.equal(attempts, 1);
}

{
  const request = agentModule.detectDirectImageRequest("帮我生成一个鸡腿跳舞的图片", []);
  assert.equal(request?.capability, "image_generation");
  assert.equal(agentModule.detectDirectImageRequest("帮我画一只猫", [])?.capability, "image_generation");
  assert.equal(agentModule.detectDirectImageRequest("请生成一个公司 Logo", [])?.capability, "image_generation");
  assert.equal(agentModule.detectDirectImageRequest("为什么没有调用图片生成工具", []), null);
  const edit = agentModule.detectDirectImageRequest("请修改这张图片，让它更亮", [{ type: "image", url: "/uploads/test.png", name: "test.png" }]);
  assert.equal(edit?.capability, "image_editing");
}

console.log("AI streaming verification passed");
process.exit(0);
