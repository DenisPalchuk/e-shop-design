function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

type Primitive = string | number | boolean;
type Comparable = Primitive | Date;
type LteFilter = { $lte: Comparable };
type FilterValue = Comparable | LteFilter;
type Filter = Record<string, FilterValue>;
type UpdateShape = {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
};

export class InMemoryCollection<TDoc extends { _id: string }> {
  private readonly docs = new Map<string, TDoc>();

  private isLteFilter(value: FilterValue): value is LteFilter {
    return typeof value === "object" && value !== null && "$lte" in value;
  }

  private matches(doc: TDoc, filter: Filter): boolean {
    return Object.entries(filter).every(([key, expected]) => {
      const actual = (doc as Record<string, Comparable | null | undefined>)[key];

      if (this.isLteFilter(expected)) {
        if (actual === undefined || actual === null) {
          return false;
        }

        return actual <= expected.$lte;
      }

      return actual === expected;
    });
  }

  async insertOne(
    doc: TDoc,
  ): Promise<{ acknowledged: boolean; insertedId: string }> {
    if (this.docs.has(doc._id)) {
      const error = new Error(`Duplicate key: ${doc._id}`) as Error & {
        code?: number;
      };
      error.code = 11000;
      throw error;
    }

    this.docs.set(doc._id, clone(doc));
    return { acknowledged: true, insertedId: doc._id };
  }

  async findOne(filter: Filter): Promise<TDoc | null> {
    for (const doc of this.docs.values()) {
      if (this.matches(doc, filter)) {
        return clone(doc);
      }
    }

    return null;
  }

  async updateOne(
    filter: Filter,
    update: UpdateShape,
  ): Promise<{
    acknowledged: boolean;
    matchedCount: number;
    modifiedCount: number;
  }> {
    for (const [id, doc] of this.docs.entries()) {
      if (!this.matches(doc, filter)) {
        continue;
      }

      const next = clone(doc) as Record<string, unknown>;

      if (update.$set) {
        for (const [key, value] of Object.entries(update.$set)) {
          next[key] = clone(value);
        }
      }

      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) {
          delete next[key];
        }
      }

      this.docs.set(id, next as TDoc);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }

    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  }

  async deleteOne(
    filter: Filter,
  ): Promise<{ acknowledged: boolean; deletedCount: number }> {
    for (const [id, doc] of this.docs.entries()) {
      if (!this.matches(doc, filter)) {
        continue;
      }

      this.docs.delete(id);
      return { acknowledged: true, deletedCount: 1 };
    }

    return { acknowledged: true, deletedCount: 0 };
  }

  count(): number {
    return this.docs.size;
  }
}

export class InMemoryDb {
  private readonly collections = new Map<
    string,
    InMemoryCollection<{ _id: string }>
  >();

  collection<TDoc extends { _id: string }>(
    name: string,
  ): InMemoryCollection<TDoc> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new InMemoryCollection<{ _id: string }>());
    }

    return this.collections.get(name)! as InMemoryCollection<TDoc>;
  }
}
