// 三遍渲染：液滴 → 液面高度 → 打光合成。对应 v7 的 357–370、692–734 行。
import { FS_TRI, SPLAT_VS, SPLAT_VS_UNION, SPLAT_FS, BLUR_FS, COMP_FS } from './shaders.js';
import { program, nearestTex, makeTarget, freeTarget } from './context.js';
import { HW_CARD, CELL_CSS } from '../core/look.js';

export class Renderer {
  constructor(gl) {
    this.gl = gl;
    this.pSplatV7 = program(gl, SPLAT_VS, SPLAT_FS);
    this.pSplatUnion = program(gl, SPLAT_VS_UNION, SPLAT_FS);
    this.pBlur = program(gl, FS_TRI, BLUR_FS);
    this.pComp = program(gl, FS_TRI, COMP_FS);
    this.vao = gl.createVertexArray();      // 没有顶点数据：每滴液体只靠编号在显卡里算
    this.texEmpty = nearestTex(gl);
    this.splat = this.hA = this.hB = this.hC = this.hD = null;
  }

  resize(W, H) {
    const gl = this.gl;
    for (const t of [this.splat, this.hA, this.hB, this.hC, this.hD]) freeTarget(gl, t);
    this.splat = makeTarget(gl, W, H);
    const hw2 = Math.ceil(W / 2), hh2 = Math.ceil(H / 2), hw4 = Math.ceil(W / 4), hh4 = Math.ceil(H / 4);
    this.hA = makeTarget(gl, hw2, hh2, gl.R16F, gl.RED); this.hB = makeTarget(gl, hw2, hh2, gl.R16F, gl.RED);
    this.hC = makeTarget(gl, hw4, hh4, gl.R16F, gl.RED); this.hD = makeTarget(gl, hw4, hh4, gl.R16F, gl.RED);
  }

  get ready() { return !!this.splat; }

  // f：本帧的全部状态 { W, H, DPR, N, cur, nxt, card, blob, pool, mouse, uT, mode, time, retFrom, sweep, move, union }
  render(f) {
    const { gl, pBlur, pComp, splat, hA, hB, hC, hD } = this;
    const pSplat = f.union ? this.pSplatUnion : this.pSplatV7;
    const { W, H, DPR, N, card, blob, pool, mouse } = f;

    // 1. 把每滴液体画进“液体厚度 + 颜色”图
    gl.bindFramebuffer(gl.FRAMEBUFFER, splat.fb); gl.viewport(0, 0, splat.w, splat.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pSplat.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, f.cur ? f.cur.tex : this.texEmpty); gl.uniform1i(pSplat.u.uContent, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, f.nxt ? f.nxt.tex : this.texEmpty); gl.uniform1i(pSplat.u.uContentB, 1);
    if (card) gl.uniform4f(pSplat.u.uCard, card.x, card.y, card.w, card.h); else gl.uniform4f(pSplat.u.uCard, 0, 0, 0, 0);
    gl.uniform3f(pSplat.u.uBlob, blob.x, blob.y, blob.r); gl.uniform3f(pSplat.u.uPool, pool.x, pool.y, pool.r);
    gl.uniform2f(pSplat.u.uRes, W, H); gl.uniform2f(pSplat.u.uMouse, mouse.x, mouse.y); gl.uniform2f(pSplat.u.uMVel, mouse.vx, mouse.vy);
    gl.uniform1f(pSplat.u.uN, N); gl.uniform1f(pSplat.u.uT, f.uT); gl.uniform1f(pSplat.u.uMode, f.mode);
    gl.uniform1f(pSplat.u.uTime, f.time); gl.uniform1f(pSplat.u.uDpr, DPR);
    gl.uniform1f(pSplat.u.uHwBlob, 2 * Math.PI * blob.r ** 3 / (3 * N)); gl.uniform1f(pSplat.u.uHwCard, HW_CARD);
    gl.uniform1f(pSplat.u.uCell, CELL_CSS * DPR); gl.uniform1f(pSplat.u.uDown, mouse.down); gl.uniform1f(pSplat.u.uFrom, f.retFrom);
    const un = f.union;                      // 尺寸不同的画面之间直接变换（null 时走 v7 原路径）
    if (un) {
      gl.uniform1f(pSplat.u.uUnion, 1);
      gl.uniform4f(pSplat.u.uOffs, un.A.x - un.U.x, un.A.y - un.U.y, un.B.x - un.U.x, un.B.y - un.U.y);
      gl.uniform4f(pSplat.u.uSizes, un.A.w, un.A.h, un.B.w, un.B.h);
    }
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.POINTS, 0, N); gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // 2. 厚度模糊成液面高度
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(pBlur.p); gl.uniform1i(pBlur.u.uTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hA.fb); gl.viewport(0, 0, hA.w, hA.h);
    gl.bindTexture(gl.TEXTURE_2D, splat.tex); gl.uniform2f(pBlur.u.uDir, 3 * DPR / splat.w, 0); gl.uniform4f(pBlur.u.uMask, 0, 0, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hB.fb);
    gl.bindTexture(gl.TEXTURE_2D, hA.tex); gl.uniform2f(pBlur.u.uDir, 0, 1.5 * DPR / hA.h); gl.uniform4f(pBlur.u.uMask, 1, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hC.fb); gl.viewport(0, 0, hC.w, hC.h);           // 大范围液面（厚液体用）
    gl.bindTexture(gl.TEXTURE_2D, hB.tex); gl.uniform2f(pBlur.u.uDir, 6 * DPR / W, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hD.fb);
    gl.bindTexture(gl.TEXTURE_2D, hC.tex); gl.uniform2f(pBlur.u.uDir, 0, 6 * DPR / H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. 按液面高度打光、反射、折射
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(pComp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, splat.tex); gl.uniform1i(pComp.u.uD, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, hB.tex); gl.uniform1i(pComp.u.uH, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hD.tex); gl.uniform1i(pComp.u.uHL, 2);
    gl.uniform2f(pComp.u.uRes, W, H); gl.uniform1f(pComp.u.uTime, f.time); gl.uniform1f(pComp.u.uSweep, f.sweep);
    gl.uniform1f(pComp.u.uMove, f.move); gl.uniform1f(pComp.u.uDpr, DPR); gl.uniform1f(pComp.u.uHwCard, HW_CARD);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  destroy() {
    const gl = this.gl;
    for (const t of [this.splat, this.hA, this.hB, this.hC, this.hD]) freeTarget(gl, t);
    for (const p of [this.pSplatV7, this.pSplatUnion, this.pBlur, this.pComp]) gl.deleteProgram(p.p);
    gl.deleteVertexArray(this.vao); gl.deleteTexture(this.texEmpty);
    this.splat = null;
  }
}
