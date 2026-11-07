import { TextPropertyAnimatorsEditor } from './TextPropertyAnimatorsEditor';
import {
  TEXT_ANIMATION_LABELS,
  TEXT_ANIMATION_TYPES,
  isCountingTextAnimation,
  isRollingTextAnimation,
  textAnimationSplit,
  type CustomActionDefinition,
  type TextAnimation,
} from '@ograf-editor/scene-model';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';
import { FrameDurationControl } from './FrameDurationControl';

interface TextAnimationEditorProps {
  animation: TextAnimation;
  unitCount: number;
  frameRate: number;
  customActions: CustomActionDefinition[];
  clock?: boolean;
  currentFrame?: number;
  colorAllowed?: boolean;
  gradientColor?: boolean;
  onChange: (patch: Partial<TextAnimation>) => void;
}

export function TextAnimationEditor({
  animation,
  unitCount,
  frameRate,
  customActions,
  clock = false,
  currentFrame = 0,
  colorAllowed = true,
  gradientColor = false,
  onChange,
}: TextAnimationEditorProps) {
  const counting = isCountingTextAnimation(animation.type);
  const rolling = isRollingTextAnimation(animation.type);
  return (
    <CollapsibleSection
      sectionId={clock ? 'properties.clock-text-animation' : 'properties.text-animation'}
      title={
        animation.type === 'none'
          ? clock
            ? 'Update text FX'
            : 'Text animation'
          : `${clock ? 'Update text FX' : 'Text animation'} · ${TEXT_ANIMATION_LABELS[animation.type]}`
      }
      defaultOpen={false}
    >
      <PropertyRow
        help={
          clock
            ? 'Animate the formatted clock or timer text. Enable replay on time change to repeat the effect as displayed digits change.'
            : 'Animate text segments from the lifecycle Start frame. The complete text stays measured while the animation plays.'
        }
        className="inspector-row"
      >
        <span>Effect</span>
        <select
          aria-label="Animation effect"
          value={animation.type}
          onChange={(event) =>
            onChange({
              type: event.target.value as TextAnimation['type'],
              ...(clock && animation.type === 'none' && event.target.value !== 'none'
                ? { replayOnUpdate: true }
                : {}),
            })
          }
        >
          {TEXT_ANIMATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TEXT_ANIMATION_LABELS[type]}
            </option>
          ))}
        </select>
      </PropertyRow>
      <TextPropertyAnimatorsEditor
        animators={animation.animators ?? []}
        currentFrame={currentFrame}
        frameRate={frameRate}
        blocked={false}
        colorAllowed={colorAllowed}
        gradientColor={gradientColor}
        onChange={(animators) => onChange({ animators })}
      />
      {animation.type === 'none' && !!animation.animators?.length && (
        <>
          <PropertyRow
            help="Replay the property animators when text data changes."
            className="inspector-row"
          >
            <span>{clock ? 'Replay on time change' : 'Replay on update'}</span>
            <input
              type="checkbox"
              aria-label="Replay property animators on update"
              checked={animation.replayOnUpdate}
              onChange={(event) => onChange({ replayOnUpdate: event.currentTarget.checked })}
            />
          </PropertyRow>
          <PropertyRow
            help="Choose a custom action that replays the property animators."
            className="inspector-row"
          >
            <span>Replay action</span>
            <select
              aria-label="Property animator replay custom action"
              value={animation.customActionId ?? ''}
              onChange={(event) => onChange({ customActionId: event.currentTarget.value || null })}
            >
              <option value="">None</option>
              {customActions.map((action) => (
                <option key={action.id} value={action.actionId}>
                  {action.name} ({action.actionId})
                </option>
              ))}
            </select>
          </PropertyRow>
        </>
      )}
      {animation.type !== 'none' ? (
        <>
          {counting ? (
            <PropertyRow
              help="Both counting effects finish at the number written in the text. Leave From empty for an automatic start. Count up starts at or below the target; Count down starts at or above it."
              className="inspector-row"
            >
              <span>From</span>
              <input
                aria-label="Text count starting value"
                type="number"
                step="any"
                placeholder="Automatic"
                value={animation.countFrom ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({ countFrom: value === '' ? null : Number(value) });
                }}
              />
            </PropertyRow>
          ) : (
            <PropertyRow
              help="Grapheme mode preserves emoji and combining marks. Word mode reveals complete words and punctuation tokens."
              className="inspector-row"
            >
              <span>Split by</span>
              <select
                aria-label="Text animation split unit"
                value={textAnimationSplit(animation)}
                disabled={animation.type === 'word-reveal'}
                onChange={(event) =>
                  onChange({ split: event.target.value as TextAnimation['split'] })
                }
              >
                <option value="grapheme">Characters</option>
                <option value="word">Words</option>
              </select>
            </PropertyRow>
          )}
          {counting ? (
            <PropertyRow
              help="Animate the changing counter digits vertically while the number counts toward its target."
              className="inspector-row"
            >
              <span>Digit motion</span>
              <select
                aria-label="Counter digit motion"
                value={animation.countRoll ?? 'none'}
                onChange={(event) =>
                  onChange({ countRoll: event.target.value as TextAnimation['countRoll'] })
                }
              >
                <option value="none">None</option>
                <option value="up">Roll up</option>
                <option value="down">Roll down</option>
              </select>
            </PropertyRow>
          ) : null}
          {rolling ? (
            <p className="inspector-hint">
              Changed characters roll from the previous value when data or time updates. Enable
              replay below to animate those changes. Unchanged characters stay still.
            </p>
          ) : null}
          {counting ? (
            <p className="inspector-hint">
              Counts one number to the value written in the text, preserving decimals, grouping,
              leading zeros, and surrounding text. Timecodes and text with multiple numbers stay
              unchanged. Use a single-number clock format for this effect.
            </p>
          ) : null}
          <FrameDurationControl
            label="Text animation"
            frames={animation.durationFrames}
            frameRate={frameRate}
            minFrames={1}
            propertyColumns
            onChange={(frames) => onChange({ durationFrames: frames })}
          />
          {animation.type === 'typewriter' ? (
            <PropertyRow
              help="Convert the current sample text's typing speed into a fixed frame duration."
              className="inspector-row"
            >
              <span>Typing speed</span>
              <input
                aria-label="Typewriter units per second"
                type="number"
                min={0.1}
                step={0.5}
                value={Number((unitCount / (animation.durationFrames / frameRate)).toFixed(2))}
                onChange={(event) => {
                  const unitsPerSecond = Math.max(0.1, Number(event.target.value));
                  onChange({
                    durationFrames: Math.max(
                      1,
                      Math.round((unitCount / unitsPerSecond) * frameRate),
                    ),
                  });
                }}
              />
              <span>/s</span>
            </PropertyRow>
          ) : null}
          {animation.type === 'typewriter' ? (
            <PropertyRow
              help="Optional deterministic cursor rendered by the graphic, separate from the editor's text caret."
              className="inspector-row"
            >
              <span>Cursor</span>
              <select
                aria-label="Typewriter cursor"
                value={animation.cursor}
                onChange={(event) =>
                  onChange({ cursor: event.target.value as TextAnimation['cursor'] })
                }
              >
                <option value="none">None</option>
                <option value="bar">Bar</option>
                <option value="block">Block</option>
              </select>
            </PropertyRow>
          ) : null}
          {animation.type === 'typewriter' && animation.cursor !== 'none' ? (
            <FrameDurationControl
              label="Blink period"
              frames={animation.cursorBlinkFrames}
              frameRate={frameRate}
              minFrames={1}
              onChange={(cursorBlinkFrames) => onChange({ cursorBlinkFrames })}
              propertyColumns
            />
          ) : null}
          <PropertyRow
            help={
              clock
                ? 'Replay only when the displayed time changes, according to its selected format. An automatic minutes-only clock updates once each minute; manual clocks replay when external data changes the display.'
                : 'Replay from the beginning when updateAction changes the data field bound to this text content.'
            }
            className="inspector-row"
          >
            <span>{clock ? 'Replay on time change' : 'Replay on update'}</span>
            <input
              aria-label={
                clock
                  ? 'Replay text animation on time change'
                  : 'Replay text animation on data update'
              }
              type="checkbox"
              checked={animation.replayOnUpdate}
              onChange={(event) => onChange({ replayOnUpdate: event.target.checked })}
            />
          </PropertyRow>
          <PropertyRow
            help="An OGraf customAction can replay the effect without changing lifecycle state. Create and name actions in Data → Custom Actions."
            className="inspector-row"
          >
            <span>Replay action</span>
            <select
              aria-label="Text animation replay custom action"
              value={animation.customActionId ?? ''}
              onChange={(event) => onChange({ customActionId: event.target.value || null })}
            >
              <option value="">None</option>
              {customActions.map((action) => (
                <option key={action.id} value={action.actionId}>
                  {action.name} ({action.actionId})
                </option>
              ))}
            </select>
          </PropertyRow>
          <p className="inspector-hint">
            {clock
              ? 'Only a change in formatted text triggers an update. Keep the effect shorter than the displayed update interval; for seconds, use less than one second.'
              : 'The initial reveal starts at frame 0. Keep its duration inside the IN transition if it should be complete at the first OGraf Step.'}
          </p>
        </>
      ) : null}
    </CollapsibleSection>
  );
}
