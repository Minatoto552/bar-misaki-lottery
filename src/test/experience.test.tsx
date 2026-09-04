// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from '../components/Feedback';
import { LotteryGacha } from '../components/LotteryGacha';
import { LotteryPage } from '../pages/LotteryPage';
import { cancelWinnerByCode, confirmWinnerByCode, ensureDeviceToken, getAdminLotterySnapshot, loginAdmin, lookupWinnerCode, publishLotteryResults, redrawLottery, resetLottery, runLottery, submitLotteryEntry } from '../lib/lottery-api';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()});
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(node: ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
async function click(button: Element | undefined | null) { expect(button).toBeTruthy(); await act(async () => (button as HTMLElement).click()); }
const byText = (text:string) => [...document.querySelectorAll('button')].find(button=>button.textContent?.includes(text));
async function winnerFixture() {
  await submitLotteryEntry({kind:'private',representativeId:'@ui_test',representativeVrcName:'Test Guest',token:ensureDeviceToken()});
  await loginAdmin('3331');
  await runLottery({enabledKinds:['private'],winnerSlots:{counter:0,private:1,table:0}});
  await publishLotteryResults();
  return (await getAdminLotterySnapshot()).entries[0].winnerCode!;
}

describe('redesigned lottery experience', () => {
  it('shows the application without the removed video', async () => {
    await render(<LotteryPage />);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelectorAll('.seat-option')).toHaveLength(3);
    expect(document.querySelectorAll('.gallery-coin')).toHaveLength(9);
  });
  it('requires typed confirmation before a reset action', async () => {
    const close = vi.fn();
    await render(<ConfirmModal title="リセット" description="test" keyword="リセット" onClose={close} />);
    expect((byText('実行する') as HTMLButtonElement).disabled).toBe(true);
    await click(byText('キャンセル'));
    expect(close).toHaveBeenCalledWith(false);
  });
  it('requires coin selection then reveals the fixed result within one second', async () => {
    vi.useFakeTimers();
    await render(<LotteryGacha entryId="test" roundId="round" resultVersion="winner"><p>固定された結果</p></LotteryGacha>);
    expect((byText('このコインで抽選する') as HTMLButtonElement).disabled).toBe(true);
    await click(document.querySelector('[role=radio]'));
    await click(byText('このコインで抽選する'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(container.textContent).toContain('固定された結果');
  });
  it('restores a winner by code and confirms only after confirmation', async () => {
    const code = await winnerFixture();
    localStorage.setItem('bar-misaki-winner-code',code);
    await render(<LotteryPage />);
    expect(container.textContent).toContain(code);
    await click(byText('コードを確認'));
    expect(document.querySelector('dialog')?.textContent).toContain('WINNER CODEを確認済みにしますか？');
    expect((await getAdminLotterySnapshot()).entries[0].confirmedAt).toBeNull();
    await click(byText('キャンセル'));
    await click(byText('コードを確認'));
    await click(byText('確認済みにする'));
    expect((await getAdminLotterySnapshot()).entries[0].confirmedAt).toBeTruthy();
    expect(container.textContent).toContain('確認済み');
  });
  it('requires cancellation confirmation and shows a distinct cancelled result', async () => {
    const code = await winnerFixture(); localStorage.setItem('bar-misaki-winner-code',code);
    await render(<LotteryPage />);
    await click(byText('当選を取り消す'));
    expect((await lookupWinnerCode(code)).entry?.status).toBe('winner');
    await click(document.querySelector('dialog .button-danger'));
    expect((await getAdminLotterySnapshot()).entries[0].status).toBe('cancelled');
    expect(container.textContent).toContain('当選を取り消しました');
    expect(container.textContent).not.toContain('キャストコインを選ぶ');
  });
  it('preserves locked winners during redraw and code status across devices', async () => {
    await submitLotteryEntry({kind:'private',representativeId:'@redraw',representativeVrcName:'Guest',token:ensureDeviceToken()});
    await loginAdmin('3331'); await runLottery({enabledKinds:['private'],winnerSlots:{counter:0,private:1,table:0}});
    const entry=(await getAdminLotterySnapshot()).entries[0];
    await redrawLottery([entry.id]);
    expect((await getAdminLotterySnapshot()).entries[0].winnerCode).toBe(entry.winnerCode);
    await publishLotteryResults();
    await confirmWinnerByCode(entry.winnerCode!);
    expect((await lookupWinnerCode(entry.winnerCode!)).entry?.confirmedAt).toBeTruthy();
    await cancelWinnerByCode(entry.winnerCode!);
    expect((await lookupWinnerCode(entry.winnerCode!)).entry?.status).toBe('cancelled');
    await resetLottery('リセット'); expect((await getAdminLotterySnapshot()).entries).toHaveLength(0);
  });
});
