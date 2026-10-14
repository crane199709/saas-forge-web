/** Remote 的只读展示能力；品牌只经宿主 Theme Token 继承。 */
export interface RemoteDisplayHost {
  text(
    key: 'title' | 'form' | 'name' | 'submit' | 'success' | 'number' | 'money' | 'date' | 'instant',
    values?: Record<string, string>
  ): string;
  number(value: string): string;
  money(value: string, currency: string): string;
  date(value: string): string;
  instant(value: string): string;
}
