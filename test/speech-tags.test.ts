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
      ["Hi [laff] there.", ["Unknown speech tag [laff], did you mean [laugh]?"]],
      [
        "Hi [laff] there. <wisper>Quiet.</wisper>",
        ["Unknown speech tag [laff], did you mean [laugh]?", "Unknown speech tag <wisper>, did you mean <whisper>?"],
      ],
      ["Then a [door-creak] sounded.", ["Unknown speech tag [door-creak]."]],
      [
        "Ha [laughs], [sighing], [long-paws].",
        [
          "Unknown speech tag [laughs], did you mean [laugh]?",
          "Unknown speech tag [sighing], did you mean [sigh]?",
          "Unknown speech tag [long-paws], did you mean [long-pause]?",
        ],
      ],
      ["<lower>Listen.</lower>", ["Unknown speech tag <lower>, did you mean <lower-pitch>?"]],
      ["Wait [whisper] now.", ["[whisper] is a wrapping tag, use <whisper>…</whisper>."]],
      ["Wait <pause> now.", ["<pause> is an inline tag, use [pause]."]],
      ["<whisper>It is a secret.", ["<whisper> is never closed."]],
      ["It is a secret.</whisper>", ["</whisper> has no opening tag."]],
      ["It is a secret.</wisper>", ["Unknown speech tag </wisper>, did you mean </whisper>?"]],
      ["<slow><soft>Goodnight.</slow></soft>", ["Close <soft> before </slow>."]],
      [
        'Grok said so.<citation id="web:23"/> <b>Bold</b> </grok:render>',
        ['<citation id="web:23"/> is not a speech tag.', "Unknown speech tag <b>.", "</grok:render> is not a speech tag."],
      ],
      [
        '<whisper volume="low">Quiet.</whisper> <pause/>',
        ['<whisper volume="low"> is not a speech tag.', "</whisper> has no opening tag.", "<pause/> is not a speech tag."],
      ],
      ["<slow><soft>Goodnight.</soft></slow> [pause] Press [Enter] [1] [citation needed].", []],
    ];
    for (const [text, problems] of cases) {
      expect(checkSpeechText(text), text).toEqual(problems);
    }
  });

  it("reads bracketed words that don't resemble a known tag as text", () => {
    for (const text of [
      "They said [they] would bring [them] to [the] show.",
      "He said it was fine [sic].",
      "Then the [music] started.",
    ]) {
      expect(checkSpeechText(text), text).toEqual([]);
      expect(stripInvalidSpeechTags(text), text).toBe(text);
    }
  });

  it("leaves text that only looks like markup", () => {
    const text = "Visit <https://x.ai> or write to <support@x.ai>. If a < b and c > d, then <3.";
    expect(checkSpeechText(text)).toEqual([]);
    expect(stripInvalidSpeechTags(text)).toBe(text);
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
      ["They said [they] would come [laughs].", "They said [they] would come ."],
      [
        'Grok said so.<citation id="web:23"/> <whisper>Quiet <b>now</b>.</whisper>',
        "Grok said so. <whisper>Quiet now.</whisper>",
      ],
      ['<whisper volume="low">Quiet.</whisper> <pause/> <grok:render type="x">23</grok:render>', "Quiet.  23"],
      ['<a title="[laff]">Link</a>', "Link"],
    ];
    for (const [text, stripped] of cases) {
      expect(stripInvalidSpeechTags(text), text).toBe(stripped);
      expect(checkSpeechText(stripInvalidSpeechTags(text)), text).toEqual([]);
    }
  });
});
