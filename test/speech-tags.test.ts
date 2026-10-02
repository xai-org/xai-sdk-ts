import { describe, expect, it } from "vitest";
import {
  INLINE_SPEECH_TAGS,
  WRAPPING_SPEECH_TAGS,
  checkSpeechText,
  stripInvalidSpeechTags,
} from "../src/index.js";

describe("checkSpeechText", () => {
  it("reports the same problems as the SpeechText type", () => {
    const cases: Array<[string, Array<string>]> = [
      ["Hi [luff] there.", ["Unknown speech tag [luff], did you mean [laugh]?"]],
      [
        "Hi [luff] there. <wisper>Quiet.</wisper>",
        ["Unknown speech tag [luff], did you mean [laugh]?", "Unknown speech tag <wisper>, did you mean <whisper>?"],
      ],
      ["Then the [music] started.", ["Unknown speech tag [music]."]],
      ["<lower>Listen.</lower>", ["Unknown speech tag <lower>, did you mean <lower-pitch>?"]],
      ["Wait [whisper] now.", ["[whisper] is a wrapping tag, use <whisper>…</whisper>."]],
      ["Wait <pause> now.", ["<pause> is an inline tag, use [pause]."]],
      ["<whisper>It is a secret.", ["<whisper> is never closed."]],
      ["It is a secret.</whisper>", ["</whisper> has no opening tag."]],
      ["It is a secret.</wisper>", ["Unknown speech tag </wisper>, did you mean </whisper>?"]],
      ["<slow><soft>Goodnight.</slow></soft>", ["Close <soft> before </slow>."]],
      ["<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter] [1] [citation needed].", []],
    ];
    for (const [text, problems] of cases) {
      expect(checkSpeechText(text), text).toEqual(problems);
    }
  });

  it("lists every known tag", () => {
    expect(INLINE_SPEECH_TAGS).toContain("long-pause");
    expect(WRAPPING_SPEECH_TAGS).toContain("whisper");
  });
});

describe("stripInvalidSpeechTags", () => {
  it("removes reported tags and keeps the words they wrap", () => {
    const cases: Array<[string, string]> = [
      ["Ha [laff] yes [laugh].", "Ha  yes [laugh]."],
      ["<wisper>Quiet.</wisper> Done.", "Quiet. Done."],
      ["Wait [whisper] <pause>now.", "Wait  now."],
      ["<whisper>It is a secret.", "It is a secret."],
      ["It is a secret.</whisper>", "It is a secret."],
      ["<slow><soft>Goodnight.</slow></soft>", "<soft>Goodnight.</soft>"],
      ["<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter].", "<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter]."],
      ["[[laff]laff] then [[laff]pause]", " then [pause]"],
    ];
    for (const [text, stripped] of cases) {
      expect(stripInvalidSpeechTags(text), text).toBe(stripped);
      expect(checkSpeechText(stripInvalidSpeechTags(text)), text).toEqual([]);
    }
  });
});
