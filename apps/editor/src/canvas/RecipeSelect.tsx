import type { ChangeEvent } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';

/** Adds a ready-made broadcast layout (lower third, bug, ticker…) to the composition. */
export function RecipeSelect() {
  const addLowerThird = useProjectStore((s) => s.addLowerThird);
  const addBug = useProjectStore((s) => s.addBug);
  const addTicker = useProjectStore((s) => s.addTicker);
  const addScoreboard = useProjectStore((s) => s.addScoreboard);
  const addClock = useProjectStore((s) => s.addClock);
  const selectMany = useSelectionStore((s) => s.selectMany);

  const addRecipe = (event: ChangeEvent<HTMLSelectElement>) => {
    const recipe = event.target.value;
    event.target.value = '';
    const result =
      recipe === 'lower-third'
        ? addLowerThird()
        : recipe === 'bug'
          ? addBug()
          : recipe === 'ticker'
            ? addTicker()
            : recipe === 'scoreboard'
              ? addScoreboard()
              : recipe === 'clock'
                ? addClock()
                : null;
    if (result) selectMany(Object.values(result.layers));
  };

  return (
    <select
      className="recipe-select"
      aria-label="Add broadcast recipe"
      defaultValue=""
      onChange={addRecipe}
    >
      <option value="" disabled>
        + Recipe…
      </option>
      <option value="lower-third">Lower Third</option>
      <option value="bug">Bug / DOG</option>
      <option value="ticker">Ticker / Crawl</option>
      <option value="scoreboard">Scoreboard</option>
      <option value="clock">Clock</option>
    </select>
  );
}
