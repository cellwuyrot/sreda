import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next-auth/react",()=>{const value={status:"authenticated",data:{user:{id:"admin",role:"ADMIN"}}};return {useSession:()=>value};});
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("@/components/admin/PaymentRequisiteManager",()=>({default:()=> <div>Requisite manager</div>}));
vi.mock("@/components/admin/PaymentLinkManager",()=>({default:()=> <div>Payment link manager</div>}));
import AdminPaymentsPage from "@/app/admin/payments/page";
const settings={premium_price_month:"299",vpn_price_month:"199",pay_sbp_enabled:"1",vpnpay_sbp_enabled:"1",vpnpay_same_as_premium:"0",bizpay_same_as_premium:"0",pay_acquiring_enabled:"1",vpnpay_acquiring_enabled:"1",pay_acquiring_provider:"CloudPayments",vpnpay_acquiring_provider:"CloudPayments",pay_acquiring_secret_set:"1",vpnpay_acquiring_secret_set:"1"};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function setup(){
 const fetcher=vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit)=>({ok:true,json:async()=>settings}));vi.stubGlobal("fetch",fetcher);
 render(<AdminPaymentsPage/>);await screen.findByRole("heading",{name:"Стоимость подписки"});return fetcher;
}
function expectNoCloudPayments(){
 expect(screen.queryByText(/CloudPayments — интернет-эквайринг/)).toBeNull();
 expect(screen.queryByText("Public ID CloudPayments")).toBeNull();
 expect(screen.queryByRole("button",{name:"Настроить уведомления"})).toBeNull();
 expect(screen.queryByPlaceholderText("pk_...")).toBeNull();
}
describe("admin payment sections without CloudPayments cards",()=>{
 it("removes acquiring controls from Premium but retains price and SBP",async()=>{
  await setup();expectNoCloudPayments();expect(screen.getByRole("heading",{name:"СБП-перевод"})).not.toBeNull();expect(screen.getByDisplayValue("299")).not.toBeNull();
 });
 it("removes acquiring controls from accelerated internet but retains its settings",async()=>{
  await setup();fireEvent.click(screen.getByRole("button",{name:"Ускоренный интернет"}));expectNoCloudPayments();
  expect(screen.getByDisplayValue("199")).not.toBeNull();expect(screen.getByRole("heading",{name:"СБП-перевод"})).not.toBeNull();
 });
 it("keeps business acquiring, link payments and requisite templates",async()=>{
  await setup();fireEvent.click(screen.getByRole("button",{name:"Бизнес"}));expect(screen.getByRole("heading",{name:/Интернет-эквайринг/i})).not.toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Оплата по ссылке"}));expect(screen.getByText("Payment link manager")).not.toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Шаблоны счетов"}));expect(screen.getByText("Requisite manager")).not.toBeNull();
 });
 it("saving remaining settings does not disable configured acquiring or clear keys",async()=>{
  const fetcher=await setup();fireEvent.click(screen.getByRole("button",{name:/Сохранить/}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));
  const request=fetcher.mock.calls.find(call=>call[1]?.method==="PUT")!;
  const body=JSON.parse(request[1]!.body as string);
  expect(body.pay_acquiring_enabled).toBe("1");expect(body.vpnpay_acquiring_enabled).toBe("1");
  expect(body.pay_acquiring_secret_clear).toBeUndefined();expect(body.vpnpay_acquiring_secret_clear).toBeUndefined();
  expect(fetcher.mock.calls.some(call=>String(call[0]).includes("/cloudpayments"))).toBe(false);
 });
});
