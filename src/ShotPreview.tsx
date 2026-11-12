import {planShots, type planShot} from './shot-plan';

type Options = Parameters<typeof planShot>[1];
export default function ShotPreview({prompts, options}: {prompts: string[]; options: Options}) {
  if (!prompts.length) return null;
  try {
    const shots = planShots(prompts, options);
    const automatic = shots.some(shot => shot.automaticCharacters || shot.automaticDuration);
    if (!automatic) return null;
    return <details className="shot-plan" open={shots.length === 1}>
      <summary>{shots.length === 1 ? 'Shot settings' : 'Review ' + shots.length + ' shots'} · ready</summary>
      <ol>{shots.map((shot, index) => <li key={index}>
        <strong>{shots.length > 1 ? 'Prompt ' + (index + 1) + ' · ' : ''}{['image', 'qwen'].includes(options.mode) ? 'Image' : shot.duration + 's'}</strong>
        <span>{shot.references.images.map((reference, i) => reference.name + ' → Picture ' + (i + 1)).join(' · ') || (options.mode === 'r2v' ? 'Voice references' : 'Text prompt')}
          {shot.references.audios.length > 0 && ' · ' + shot.references.audios.map((reference, i) => reference.name + ' → Audio ' + (i + 1)).join(' · ')}
        </span>
      </li>)}</ol>
      <p>Each shot uses its listed duration and references. Render size and quality follow your settings.</p>
    </details>;
  } catch (error) {
    return <p className="error" role="status">{(error as Error).message}</p>;
  }
}
