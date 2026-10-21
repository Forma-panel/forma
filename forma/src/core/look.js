// v7 外观常量。外观红线：改这里的数值就是改外观，必须更新 reference 并经过确认。

export const FORM_T = 1.5;      // 成形时长（秒）
export const RETURN_T = 1.35;   // 收回时长
export const MORPH_T = 1.55;    // 页面之间直接变换时长
export const UNION_T = 1.75;    // 尺寸不同的页面之间直接变换时长
export const UNION_BUDGET = .95; // 并集矩形最多占用的液滴比例
export const TEXT_DELAY = .25;  // 成形结束后多久显示可选文字层
export const SETTLE_GAP = .3;   // 成形落定后多久才接受下一次变换

export const CARD_W = 540, CARD_H = 370;   // 默认卡片尺寸（CSS 像素）
export const HW_CARD = 3;                  // 卡片液滴权重
export const CELL_CSS = 20;                // 液流分束的格子大小
export const CARD_BUDGET = .8;             // 卡片最多用掉总液量的比例
export const MIN_DROPS = 1 << 18;
export const MAX_DROPS = 1 << 22;           // 液滴上限（约 420 万），再大就缩小卡片

// 液团半径（CSS 像素）：更小、更精致
export function blobRadiusCss(W, H, DPR) { return Math.max(56, Math.min(96, Math.min(W, H) / DPR * .11)); }
