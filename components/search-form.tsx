type SearchFormProps = {
  defaultValue?: string;
  action?: string;
  buttonText?: string;
  placeholder?: string;
};

/** GET 搜索表单，使搜索 URL 可分享且无需客户端 JavaScript 状态 */
export function SearchForm({
  defaultValue = "",
  action = "/search",
  buttonText = "搜索",
  placeholder = "搜索通知标题，例如：考试、转专业",
}: SearchFormProps) {
  return (
    <form action={action} className="search-form">
      <label className="sr-only" htmlFor="q">
        搜索通知标题
      </label>
      <input
        defaultValue={defaultValue}
        id="q"
        name="q"
        placeholder={placeholder}
        required
      />
      <button type="submit">{buttonText}</button>
    </form>
  );
}
