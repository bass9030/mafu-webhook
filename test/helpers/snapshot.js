// 의존성 없는 간단한 스냅샷 비교
// 스냅샷 생성/갱신: UPDATE_SNAPSHOTS=1 npm test
// 스냅샷 파일이 없으면 실패한다 (실수로 지워진 스냅샷이 조용히 통과하지 않도록).
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "__snapshots__");

function matchSnapshot(name, value) {
    const file = path.join(DIR, `${name}.json`);
    const serialized = JSON.stringify(value, null, 2) + "\n";

    if (process.env.UPDATE_SNAPSHOTS) {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(file, serialized);
        return;
    }

    if (!fs.existsSync(file)) {
        assert.fail(
            `스냅샷 없음: ${path.relative(process.cwd(), file)} (UPDATE_SNAPSHOTS=1 로 생성)`,
        );
    }

    assert.strictEqual(serialized, fs.readFileSync(file, "utf-8"));
}

module.exports = { matchSnapshot };
