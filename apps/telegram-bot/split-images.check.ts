// Self-check for splitAtMostOneImage. Run: npx tsx split-images.check.ts
import { splitAtMostOneImage } from "./split-images";
import type { ContentPart } from "arbetslag";

const t = (s: string): ContentPart => ({ type: "text", text: s });
const img = (): ContentPart => ({ type: "image", url: "data:image/jpeg;base64,xx" });

let failures = 0;
function check(name: string, parts: Array<ContentPart>, expected: Array<string>): void {
	const segments = splitAtMostOneImage(parts);
	const render = (seg: Array<ContentPart>) => seg.map((p) => (p.type === "text" ? p.text : "[img]")).join("|");
	const got = segments.map(render);
	const ok =
		got.length === expected.length &&
		got.every((line, i) => line === expected[i]);
	console.assert(ok, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
	if (!ok) failures++;
	console.log(`${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(got)}`);
}

// 0. Empty input → no segments.
check("empty", [], []);

// 1. No images → one segment, identity.
check("text only", [t("a"), t("b")], ["a|b"]);

// 2. One image → one segment (the common single-photo case: stays merged).
check("one photo with caption", [t("cap"), img()], ["cap|[img]"]);
check("photo then text", [img(), t("after")], ["[img]|after"]);

// 3. Album: two photos, no captions → two segments, one image each.
check("two photos", [img(), img()], ["[img]", "[img]"]);

// 4. Album with a trailing text message → text rides after the last image.
check("two photos + trailing text", [img(), img(), t("now describe them")], ["[img]", "[img]|now describe them"]);

// 5. Text between two images moves with the SECOND image (caption belongs to
//    the photo that follows it).
check("text between two images", [img(), t("cap2"), img()], ["[img]", "cap2|[img]"]);

// 6. Photo quoting a photo: [lead reply block, quoted image, caption, new
//    image] → the quoted photo keeps its block, the caption goes with the
//    new photo.
check(
	"photo quoting a photo",
	[t("[lead] <reply_to>[photo]</reply_to>"), img(), t("my caption"), img()],
	["[lead] <reply_to>[photo]</reply_to>|[img]", "my caption|[img]"],
);

// 7. Three images with text on both sides.
check(
	"three photos interleaved",
	[t("start"), img(), t("mid"), img(), img(), t("end")],
	["start|[img]", "mid|[img]", "[img]|end"],
);

if (failures > 0) {
	console.error(`${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("ALL CHECKS PASSED");
