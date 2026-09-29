# MongoDB + Typegoose Migration Design

**Date:** 2026-04-18
**Project:** zyncount-pos (MabizPOS)
**Scope:** Replace SQLite/TypeORM with local MongoDB + Typegoose (local migration only; Atlas sync is a separate task)

---

## Context

MabizPOS is an Electron desktop app (Nextron = Electron + Next.js). It currently uses `better-sqlite3` + TypeORM for local embedded storage. The goal is to replace this with a local MongoDB instance (installed as a system service on each POS machine) accessed via Mongoose + Typegoose.

**Out of scope:** Atlas cloud sync, installer changes, renderer changes.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| MongoDB setup | System service (`localhost:27017`) | Simplest operational model; IT sets it up once per machine |
| `_id` type | MongoDB native `ObjectId` | Idiomatic MongoDB; all cross-reference fields updated to match |
| Migration approach | Direct 1:1 replacement | Zero changes above the repository layer; lowest risk |
| Atlas sync | Not in this task | Separate task once local migration is stable |

---

## Architecture

The migration touches exactly 3 layers. Everything above is unchanged.

```
main/background.ts          ← 1 change: getDataSource() → connectDatabase()
server/container.ts         ← unchanged
server/**/*.service.ts      ← minor: TypeORM type imports replaced
────────────────────────────────────────── MIGRATION BOUNDARY
server/**/*.repository.ts   ← replaced: TypeORM repo → Mongoose model queries
server/**/*.schema.ts       ← replaced: TypeORM decorators → Typegoose decorators
server/database/            ← replaced: connection + base schema + base repository
```

**Renderer, IPC handlers, DI container (tsyringe)** — completely unchanged.

---

## Package Changes

**Remove:**
- `better-sqlite3`
- `@types/better-sqlite3`
- `typeorm`

**Add:**
- `mongoose` ^8.x
- `@typegoose/typegoose` ^12.x

**Remove from `package.json` build config:**
```json
"asarUnpack": ["**/node_modules/better-sqlite3/**/*"]
```

---

## Database Layer

### `server/database/database.ts` (replaces `data-source.ts`)

```typescript
import mongoose from 'mongoose';

export const connectDatabase = async (): Promise<void> => {
    await mongoose.connect('mongodb://localhost:27017/mabizpos');
};
```

### `server/database/schema.ts`

```typescript
import { prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export class BaseSchema {
    _id: Types.ObjectId;

    @prop({ default: () => Date.now() })
    documentDate: number;

    @prop()
    documentNo?: string;

    @prop({ default: true })
    canDelete: boolean;

    @prop({ default: true })
    canEdit: boolean;

    @prop({ default: () => Date.now() })
    createdAt: number;

    @prop({ type: Types.ObjectId })
    createdBy?: Types.ObjectId;

    @prop({ default: () => Date.now() })
    updatedAt: number;

    @prop({ type: Types.ObjectId })
    updatedBy?: Types.ObjectId;
}
```

### `server/database/repository.ts`

```typescript
import { ReturnModelType, DocumentType } from '@typegoose/typegoose';
import { Types, FilterQuery, UpdateQuery } from 'mongoose';
import { BaseSchema } from './schema';

export interface PageInput {
    page?: number;
    pageSize?: number;
    sort?: string;
    sortDir?: 'ASC' | 'DESC';
}

export interface PageResult<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export abstract class AbstractBaseRepository<T extends BaseSchema> {
    constructor(protected model: ReturnModelType<new () => T>) {}

    async findById(id: string): Promise<DocumentType<T> | null> {
        return this.model.findById(new Types.ObjectId(id)).exec();
    }

    async findOne(filter: FilterQuery<T>): Promise<DocumentType<T> | null> {
        return this.model.findOne(filter).exec();
    }

    async findAll(sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]> {
        return this.model.find().sort(sort ?? { createdAt: -1 }).exec();
    }

    async find(filter: FilterQuery<T>, sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]> {
        return this.model.find(filter).sort(sort).exec();
    }

    async page(input: PageInput, filter?: FilterQuery<T>): Promise<PageResult<DocumentType<T>>> {
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        const sort: Record<string, 1 | -1> = input.sort
            ? { [input.sort]: input.sortDir === 'ASC' ? 1 : -1 }
            : { createdAt: -1 };

        const [data, total] = await Promise.all([
            this.model.find(filter ?? {}).sort(sort).skip((page - 1) * pageSize).limit(pageSize).exec(),
            this.model.countDocuments(filter ?? {}).exec(),
        ]);

        return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }

    async create(data: Partial<T>): Promise<DocumentType<T>> {
        const now = Date.now();
        return this.model.create({ ...data, createdAt: now, updatedAt: now });
    }

    async update(id: string, data: UpdateQuery<T>): Promise<boolean> {
        const result = await this.model.updateOne(
            { _id: new Types.ObjectId(id) },
            { ...data, updatedAt: Date.now() }
        ).exec();
        return result.modifiedCount > 0;
    }

    async delete(id: string): Promise<boolean> {
        const result = await this.model.deleteOne({ _id: new Types.ObjectId(id) }).exec();
        return result.deletedCount > 0;
    }

    async count(filter?: FilterQuery<T>): Promise<number> {
        return this.model.countDocuments(filter ?? {}).exec();
    }

    async exists(filter: FilterQuery<T>): Promise<boolean> {
        return (await this.count(filter)) > 0;
    }
}
```

---

## Entity Schema Migration

### TypeORM → Typegoose Decorator Mapping

| TypeORM | Typegoose |
|---|---|
| `@Entity('collection')` | `@modelOptions({ schemaOptions: { collection: 'collection' } })` |
| `@Index('name', ['field'])` | `@index({ field: 1 })` class decorator |
| `@Column('text')` | `@prop()` |
| `@Column('real', { default: 0 })` | `@prop({ default: 0 })` |
| `@Column('integer', { default: 1 })` | `@prop({ default: true })` |
| `@Column('simple-json', { nullable: true })` | `@prop({ type: () => [Object] })` |
| `extends BaseSchema` | `extends BaseSchema` (unchanged) |

### ObjectId Cross-References

Since `_id` is `ObjectId`, all fields that store references to other documents must be `Types.ObjectId | undefined`. Affected fields across all schemas:

| Field | Found in |
|---|---|
| `orderId` | OrderItem, Stock, StockAdjustment, StockTransfer |
| `orderItemId` | Stock |
| `itemId` | OrderItem, Stock, StockAdjustment, StockTransfer |
| `stockId` | OrderItem |
| `lastStockId` | Stock |
| `storeId` | Order, Stock, StockAdjustment, StockTransfer |
| `parentId` | Order, Item, Master |
| `customerId`, `supplierId` | Order |
| `categoryId`, `typeId`, `groupId`, `uomId` | Item |
| `salesAccountId`, `costOfSalesAccountId`, `inventoryAccountId` | Item |
| `adjustmentId`, `transferId` | AdjustmentItem, TransferItem |
| `completedBy`, `createdBy`, `updatedBy` | BaseSchema + Order |

### IPC Boundary

IDs arrive from the renderer as plain strings. The repository layer handles `ObjectId` conversion internally via `new Types.ObjectId(id)`. Services and IPC handlers do not change.

### All 15 Entities to Migrate

| Schema File | Collection Name |
|---|---|
| `user/user.schema.ts` | `users` |
| `license/license.schema.ts` | `licenses` |
| `inventory/item/item.schema.ts` | `items_inventory` |
| `inventory/item/type/type.schema.ts` | `item_types` |
| `inventory/item/group/group.schema.ts` | `item_groups` |
| `inventory/stock/stock.schema.ts` | `stocks` |
| `inventory/order/order.schema.ts` | `orders` |
| `inventory/order/item/item.schema.ts` | `order_items` |
| `inventory/adjustment/adjustment.schema.ts` | `stock_adjustments` |
| `inventory/adjustment/item/item.schema.ts` | `stock_adjustment_items` |
| `inventory/transfer/transfer.schema.ts` | `stock_transfers` |
| `inventory/transfer/item/item.schema.ts` | `stock_transfer_items` |
| `master/master.schema.ts` | `masters` |
| `store/store.schema.ts` | `stores` |
| `finance/account/account.schema.ts` | `accounts` |

---

## Service Layer

### `server/services/service.ts`

Replace TypeORM imports with Mongoose equivalents:

```typescript
import { FilterQuery, UpdateQuery } from 'mongoose';
import { DocumentType } from '@typegoose/typegoose';
import { AbstractBaseRepository, PageInput, PageResult } from '../database/repository';
import { BaseSchema } from '../database/schema';

export abstract class AbstractBaseService<
    T extends BaseSchema,
    R extends AbstractBaseRepository<T> = AbstractBaseRepository<T>
> {
    constructor(protected repo: R) {}

    async create(data: Partial<T>): Promise<DocumentType<T>>
    async getById(id: string): Promise<DocumentType<T> | null>
    async getAll(sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]>
    async find(filter: FilterQuery<T>, sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]>
    async findOne(filter: FilterQuery<T>): Promise<DocumentType<T> | null>
    async page(input: PageInput, filter?: FilterQuery<T>): Promise<PageResult<DocumentType<T>>>
    async update(id: string, data: UpdateQuery<T>): Promise<boolean>
    async delete(id: string): Promise<boolean>
    async count(filter?: FilterQuery<T>): Promise<number>
    async exists(filter: FilterQuery<T>): Promise<boolean>
}
```

### Individual services

Domain-specific service methods (e.g. `OrderService.createWithItems`, `ItemService.search`, `StockService.getByItemId`) keep their existing logic. The only change is replacing TypeORM filter syntax with Mongoose `FilterQuery` objects:

```typescript
// TypeORM (before)
repo.find({ where: { itemId } })

// Mongoose (after)
this.model.find({ itemId: new Types.ObjectId(itemId) })
```

---

## Repository Pattern

Each `*.repository.ts` passes its Typegoose model to the base constructor:

```typescript
@injectable()
export class OrderRepository extends AbstractBaseRepository<Order> {
    constructor() {
        super(getModelForClass(Order));
    }

    // custom methods use this.model directly
    async findByKind(kind: string) {
        return this.model.find({ kind }).sort({ createdAt: -1 }).exec();
    }
}
```

---

## `main/background.ts` Change

```typescript
// Remove:
import { getDataSource } from '../server/database/data-source';
await getDataSource();

// Replace with:
import { connectDatabase } from '../server/database/database';
await connectDatabase();
```

---

## Files Changed Summary

| File | Action |
|---|---|
| `package.json` | Remove typeorm/sqlite deps, add mongoose/typegoose |
| `server/database/data-source.ts` | Delete |
| `server/database/database.ts` | Create |
| `server/database/schema.ts` | Rewrite |
| `server/database/repository.ts` | Rewrite |
| `server/services/service.ts` | Rewrite (type imports only) |
| `server/**/*.schema.ts` (×15) | Rewrite decorators |
| `server/**/*.repository.ts` (×13) | Rewrite using Mongoose model |
| `main/background.ts` | Replace `getDataSource()` call |

**Total files:** ~33
