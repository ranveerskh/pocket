import {characterReferences, type Character, type References} from './reference-model';

export type ShotPlan = {
  prompt: string;
  duration: number;
  characterIds: string[];
  references: References;
  automaticCharacters: boolean;
  automaticDuration: boolean;
};
const supportedDurations = [4, 5, 6, 8, 10];
const characterHeader = /^[ \t]*(?:characters|references)[ \t]*:[ \t]*(.*?)[ \t]*$/gim;
const durationHeader = /^[ \t]*duration[ \t]*:[ \t]*(.*?)[ \t]*$/gim;
const durationValue = /^(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)?\s*\.?$/i;
const normalizeName = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');

export function planShot(prompt: string, options: {
  duration: number;
  mode: string;
  characters: Character[];
  selectedIds: string[];
  base: string;
}): ShotPlan {
  const imageMode = ['image', 'qwen'].includes(options.mode);
  const headers = [...prompt.matchAll(characterHeader)];
  if (headers.length > 1) throw new Error('Use one CHARACTERS line per shot.');
  const durations = [...prompt.matchAll(durationHeader)];
  if (durations.length > 1) throw new Error('Use one DURATION line per shot.');
  let duration = options.duration;
  let automaticDuration = false;
  if (!imageMode) {
    const sceneDuration = prompt.match(/^\s*(?:scene|shot)\s+\d+[a-z]?\s*[—–:-]\s*(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)\s*\.?\s*$/im);
    const value = durations.length ? durations[0][1].match(durationValue)?.[1] : sceneDuration?.[1];
    if (durations.length && !value) throw new Error('Write DURATION: 5s, 6s, 8s or 10s.');
    if (value) {
      duration = Number(value);
      if (!supportedDurations.includes(duration)) throw new Error('Supported video durations are 4, 5, 6, 8 and 10 seconds.');
      if (durations.length && sceneDuration && duration !== Number(sceneDuration[1])) throw new Error('The scene heading and DURATION line must agree.');
      automaticDuration = true;
    }
  }
  const automaticCharacters = options.mode === 'r2v' && headers.length > 0;
  let characterIds = options.mode === 'r2v' ? options.selectedIds : [];
  if (automaticCharacters) {
    const names = headers[0][1].split(/[,|;]/).map(name => name.trim()).filter(Boolean);
    if (!names.length) throw new Error('List the saved character names after CHARACTERS:.');
    const namesUsed = new Set<string>();
    characterIds = names.map(name => {
      const normalized = normalizeName(name);
      if (namesUsed.has(normalized)) throw new Error('List each character only once.');
      namesUsed.add(normalized);
      const matches = options.characters.filter(character => character.base === options.base && normalizeName(character.name) === normalized);
      if (matches.length !== 1) throw new Error(matches.length
        ? 'More than one saved reference is named “' + name + '”. Give each version a unique name.'
        : 'Save a reference named “' + name + '” on this RunPod connection.');
      return matches[0].id;
    });
    // Numbered tags in existing prompts belong to their original manual selection.
    if (/<(?:Picture|Audio)\s+\d+>/i.test(prompt)) throw new Error('With CHARACTERS:, use character names in the scene instead of numbered Picture or Audio tags. The app assigns tags for each shot.');
  }
  const references = options.mode === 'r2v' ? characterReferences(options.characters, characterIds, options.base) : {images: [], audios: []};
  if (options.mode === 'r2v' && !references.images.length && !references.audios.length) throw new Error('Add CHARACTERS: with saved names, or select a reference manually.');
  const scenePrompt = prompt.replace(characterHeader, '').replace(durationHeader, '').trim();
  if (!scenePrompt) throw new Error('Add the scene description below the shot settings.');
  return {prompt: scenePrompt, duration, characterIds, references, automaticCharacters, automaticDuration};
}

export function planShots(prompts: string[], options: Parameters<typeof planShot>[1]) {
  return prompts.map((prompt, index) => {
    try { return planShot(prompt, options); }
    catch (error) { throw new Error('Prompt ' + (index + 1) + ': ' + (error as Error).message); }
  });
}
