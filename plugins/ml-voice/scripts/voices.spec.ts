// The voice lists, from what each API answers: run with `bun test plugins/ml-voice/scripts`.

import { expect, test } from "bun:test";
import { matching } from "./matching";
import { openrouterModels, openrouterVoices, sayVoices } from "./voices";

const MODELS = [
  { id: "fish-audio/drama-3", name: "Fish Audio: Drama 3", pricing: { prompt: "0.000002" }, supported_voices: null },
  { id: "elevenlabs/eleven-v3", name: "ElevenLabs v3", pricing: { prompt: "0.0001" }, supported_voices: ["george", "sarah", "brian"] },
  { id: "acme/plain", name: "Acme", pricing: { prompt: "0" }, supported_voices: [] },
];

test("say's listing is read with names that hold spaces and brackets", () => {
  const listing = [
    "Albert              en_US    # Hello! My name is Albert.",
    "Bad News            en_US    # The light you see at the end of the tunnel is the headlamp of a fast approaching train.",
    "Eddy (English (US)) en_US    # Hello! My name is Eddy.",
    "",
  ].join("\n");
  expect(sayVoices(listing).choices.map((one) => one.value)).toEqual(["Albert", "Bad News", "Eddy (English (US))"]);
  expect(sayVoices(listing).choices[0]!.detail).toBe("en_US · Hello! My name is Albert.");
});

test("OpenRouter's models say their price per million characters and their voices", () => {
  expect(openrouterModels(MODELS).choices.map((one) => one.detail)).toEqual([
    "$2 per million characters",
    "$100 per million characters · 3 voices",
    "free",
  ]);
});

test("an OpenRouter model's voices are its own, matched to the search", async () => {
  expect((await openrouterVoices(MODELS, "elevenlabs/eleven-v3", "")).choices).toHaveLength(3);
  expect((await openrouterVoices(MODELS, "elevenlabs/eleven-v3", "brn")).choices.map((one) => one.value)).toEqual(["brian"]);
  expect((await openrouterVoices(MODELS, "acme/plain", "")).note).toContain("lists no voices");
  expect((await openrouterVoices(MODELS, "gone/model", "")).note).toContain("pick openrouter.model first");
});

test("matching takes the search's letters in order, anywhere in the label or the value", () => {
  const choices = [{ value: "af_bella", label: "af_bella" }, { value: "bm_george", label: "bm_george" }];
  expect(matching(choices, "afbl").map((one) => one.value)).toEqual(["af_bella"]);
  expect(matching(choices, "")).toHaveLength(2);
});
