export const EBU_R95_ACTION_SAFE_MARGIN = 0.035;
export const EBU_R95_TITLE_SAFE_MARGIN = 0.05;

export interface SafeAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EbuR95SafeAreas {
  actionSafe: SafeAreaRect;
  titleSafe: SafeAreaRect;
}

function bounds(width: number, height: number, margin: number): SafeAreaRect {
  const x = Math.round(width * margin);
  const y = Math.round(height * margin);
  return { x, y, width: width - x * 2, height: height - y * 2 };
}

/** EBU R 95 16:9 safe areas: 3.5% action-safe and 5% title/graphics-safe per axis. */
export function getEbuR95SafeAreas(
  composition: Readonly<{ width: number; height: number }>,
): EbuR95SafeAreas {
  return {
    actionSafe: bounds(composition.width, composition.height, EBU_R95_ACTION_SAFE_MARGIN),
    titleSafe: bounds(composition.width, composition.height, EBU_R95_TITLE_SAFE_MARGIN),
  };
}
