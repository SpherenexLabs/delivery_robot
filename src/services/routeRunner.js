import { writeDirection } from './firebaseDatabase';

const directionCode = {
  forward: 'F',
  backward: 'B',
  left: 'L',
  right: 'R',
  stop: 'S',
};

const reverseCode = { F: 'B', B: 'F', L: 'R', R: 'L', S: 'S' };
const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export const getReturnSteps = (steps = []) =>
  [...steps].reverse().map((step) => {
    const code = step.code || directionCode[step.direction] || 'S';
    return { ...step, code: reverseCode[code] || 'S' };
  });

export const runRouteSteps = async (steps = []) => {
  const route = steps;

  for (const step of route) {
    const duration = Math.max(0, Number(step.duration) || 0);
    const code = step.code || directionCode[step.direction] || 'S';
    if (!duration) continue;
    await writeDirection(code);
    await wait(duration * 1000);
  }

  await writeDirection('S');
};
