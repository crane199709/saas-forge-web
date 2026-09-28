/** Remote 的只读展示能力；不传递会话、Client、凭据或认证 Runtime。 */
export interface RemoteDisplayHost {
  text(
    key: 'title' | 'form' | 'name' | 'submit' | 'success' | 'brand' | 'number' | 'money' | 'date' | 'instant',
    values?: Record<string, string>
  ): string;
  readonly brandName: string;
  number(value: string): string;
  money(value: string, currency: string): string;
  date(value: string): string;
  instant(value: string): string;
}
