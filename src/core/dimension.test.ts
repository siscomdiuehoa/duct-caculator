import { describe, expect, it } from 'vitest';
import { dimShape, dimStyle, outward, stack } from './dimension';

describe('dimension drawing rules', () => {
  const st = dimStyle(280);
  it('keeps extension lines off the part and past the dimension line', () => {
    const d = dimShape([0, 0], [400, 0], [0, -1], 40, st);
    expect(d.line).toEqual([[0, -40], [400, -40]]);
    const [e1] = d.ext;
    expect(e1[0][1]).toBeCloseTo(-st.gap, 9);
    expect(e1[1][1]).toBeCloseTo(-(40 + st.over), 9);
  });
  it('puts a filled arrowhead with its tip on each end of the line, pointing outwards', () => {
    const d = dimShape([0, 0], [400, 0], [0, -1], 40, st);
    expect(d.arrows[0][0]).toEqual([0, -40]);
    expect(d.arrows[1][0]).toEqual([400, -40]);
    expect(d.arrows[0][1][0]).toBeCloseTo(st.arrow, 9);
    expect(d.arrows[1][1][0]).toBeCloseTo(400 - st.arrow, 9);
  });
  it('reads from the bottom or the right: text angle stays within (-90, 90]', () => {
    expect(dimShape([0, 0], [400, 0], [0, -1], 40, st).angle).toBeCloseTo(0, 9);
    expect(dimShape([0, 0], [0, 400], [-1, 0], 40, st).angle).toBeCloseTo(90, 9);
    expect(dimShape([0, 400], [0, 0], [-1, 0], 40, st).angle).toBeCloseTo(90, 9);
  });
  it('chooses the side away from the centre and snaps to an axis', () => {
    expect(outward([0, 0], [400, 0], [200, 150])).toEqual([0, -1]);
    expect(outward([0, 300], [400, 300], [200, 150])).toEqual([0, 1]);
    expect(outward([-200, -150, 0], [-200, -150, 1000], [0, 0, 500])).toEqual([-1, 0, 0]);
  });
  it('stacks dimensions on one side with the shortest nearest the part', () => {
    const offs = stack([{ n: [0, -1], len: 400 }, { n: [0, -1], len: 100 }, { n: [-1, 0], len: 900 }], st);
    expect(offs[1]).toBeCloseTo(st.first, 9);
    expect(offs[0]).toBeCloseTo(st.first + st.step, 9);
    expect(offs[2]).toBeCloseTo(st.first, 9);
  });
});
