import type { ContentPart } from "arbetslag";

/**
 * Partition parts into segments that each hold at most one image part.
 * Splits right before an image that would be the segment's second; text
 * trailing that image moves with the new segment, because in a photo that
 * quotes a photo the caption between the two images belongs to the new
 * (second) photo, not the quoted one.
 */
export function splitAtMostOneImage(
	parts: Array<ContentPart>,
): Array<Array<ContentPart>> {
	const segments: Array<Array<ContentPart>> = [];
	let current: Array<ContentPart> = [];
	for (const part of parts) {
		if (part.type === "image" && current.some((p) => p.type === "image")) {
			let cut = current.length;
			while (cut > 0 && current[cut - 1].type === "text") cut--;
			const tail = current.splice(cut);
			segments.push(current);
			current = tail;
		}
		current.push(part);
	}
	if (current.length > 0) segments.push(current);
	return segments;
}
