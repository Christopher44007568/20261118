import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:8123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

const text = (id) => page.locator(`#${id}`).innerText();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('打开演示页面…');
await page.goto(base, { waitUntil: 'networkidle' });
await wait(900);

// 1. 首次进入：广场视角预热完成，有 FVD，真实编译数 > 0
const fvd1 = await text('mFvd');
const compiles1 = Number(await text('mCompiles'));
assert.ok(Number.parseFloat(fvd1) > 0, `FVD 应为正数，实际 ${fvd1}`);
assert.ok(compiles1 >= 4, `广场至少 4 个材质变体，实际编译 ${compiles1}`);
console.log(`  广场首进 FVD=${fvd1}ms, 真实编译=${compiles1}`);

// 2. 切换到高塔：新材质出现（全息/格栅等），编译数增加
await page.click('button[data-camera="tower"]');
await wait(1200);
const compiles2 = Number(await text('mCompiles'));
assert.ok(compiles2 > compiles1, '高塔视角应触发新变体编译');
const hitRateText = await text('mHitRate');
assert.ok(hitRateText !== '—', '命中率应有数值');
console.log(`  高塔切换后编译=${compiles2}, 命中率=${hitRateText}`);

// 3. 重返广场：零新增编译，命中率继续上升
await page.click('button[data-camera="plaza"]');
await wait(500);
const compiles3 = Number(await text('mCompiles'));
assert.equal(compiles3, compiles2, '重返广场不应产生新编译');
const fvdReturn = Number.parseFloat(await text('mFvd'));
assert.ok(fvdReturn < 5, `全命中 FVD 应趋近 0，实际 ${fvdReturn}`);
console.log(`  重返广场零编译, FVD=${fvdReturn}ms`);

// 4. 重置缓存后注入失败变体，让招牌贴花首次编译即失败，验证错误回退
await page.click('#btnFailVariant');
await page.click('#btnReset');
await page.click('button[data-camera="tower"]');
await wait(1400);
const failText = await text('mFails');
const [fails, fallbacks] = failText.split(' / ').map(Number);
assert.ok(fails >= 1 && fallbacks >= 1, `应出现失败与回退，实际 ${failText}`);
const bodyText = await page.locator('.cache-list').innerText();
assert.ok(bodyText.includes('error'), '缓存列表应存在 error 条目');
assert.ok(bodyText.includes('回退'), '应记录回退关联');
console.log(`  失败变体回退: 失败=${fails}, 回退=${fallbacks}`);

// 5. 容量淘汰：容量调到 3，观察淘汰计数增长且占用不超限
await page.fill('#capacityInput', '3');
await page.dispatchEvent('#capacityInput', 'change');
await page.click('button[data-camera="westWing"]');
await wait(1400);
const sizeText = await text('mSize');
const [size, cap] = sizeText.split(' / ').map(Number);
assert.ok(size <= cap, `缓存占用 ${size} 不能超过容量 ${cap}`);
assert.equal(cap, 3);
const evictions = Number((await text('mEvictions')).replace('淘汰 ', ''));
assert.ok(evictions >= 1, '应发生 LRU 淘汰');
console.log(`  LRU 淘汰: 占用=${sizeText}, 累计淘汰=${evictions}`);

// 6. 编译队列最终归零
const queueDepth = Number(await text('mQueueDepth'));
assert.equal(queueDepth, 0, '队列应已清空');

assert.equal(errors.length, 0, `页面存在 JS 错误: ${errors.join('; ')}`);
await page.screenshot({ path: 'artifacts/pipeline-cache-demo.png', fullPage: true });
await browser.close();
console.log('\n浏览器冒烟测试全部通过，截图: artifacts/pipeline-cache-demo.png');
