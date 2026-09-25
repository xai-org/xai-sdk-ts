type PageSource<Page, Item> = {
  first: () => Promise<Page>;
  next: (page: Page) => Promise<Page> | undefined;
  items: (page: Page) => readonly Item[];
};

/** Resolves to the first page. `for await` yields every item and fetches later pages as needed. */
export class PagePromise<Page, Item> extends Promise<Page> implements AsyncIterable<Item> {
  static get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  readonly #source: PageSource<Page, Item>;

  constructor(source: PageSource<Page, Item>) {
    super((resolve, reject) => {
      source.first().then(resolve, reject);
    });
    this.#source = source;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Item> {
    let page: Page | undefined = await this;
    while (page) {
      yield* this.#source.items(page);
      page = await this.#source.next(page);
    }
  }
}

export function tokenPages<
  Query extends { pagination_token?: string },
  Page extends { pagination_token?: string | null },
  Item,
>(
  query: Query,
  fetchPage: (query: Query) => Promise<Page>,
  items: (page: Page) => readonly Item[],
): PagePromise<Page, Item> {
  return new PagePromise({
    first: () => fetchPage(query),
    next: (page) =>
      page.pagination_token ? fetchPage({ ...query, pagination_token: page.pagination_token }) : undefined,
    items,
  });
}
