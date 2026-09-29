# MongoDB + Typegoose Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite/TypeORM with local MongoDB + Typegoose across the entire server layer of MabizPOS Electron app.

**Architecture:** Direct 1:1 replacement — TypeORM decorators become Typegoose, `AbstractBaseRepository` is rewritten using Mongoose models, and `AbstractBaseService` drops TypeORM type imports. Everything above the repository layer (IPC handlers, DI container, renderer) is untouched. MongoDB runs as a system service on `localhost:27017`.

**Tech Stack:** `mongoose` ^8.x, `@typegoose/typegoose` ^12.x, `tsyringe` (unchanged), Electron/Nextron (unchanged)

---

## File Map

| Action | File |
|---|---|
| Create | `server/database/database.ts` |
| Delete | `server/database/data-source.ts` |
| Rewrite | `server/database/schema.ts` |
| Rewrite | `server/database/repository.ts` |
| Rewrite | `server/services/service.ts` |
| Rewrite | `server/user/user.schema.ts` |
| Rewrite | `server/user/user.repository.ts` |
| Rewrite | `server/license/license.schema.ts` |
| Rewrite | `server/license/license.repository.ts` |
| Rewrite | `server/inventory/item/type/type.schema.ts` |
| Rewrite | `server/inventory/item/type/type.repository.ts` |
| Rewrite | `server/inventory/item/group/group.schema.ts` |
| Rewrite | `server/inventory/item/group/group.repository.ts` |
| Rewrite | `server/master/master.schema.ts` |
| Rewrite | `server/master/master.repository.ts` |
| Rewrite | `server/store/store.schema.ts` |
| Rewrite | `server/store/store.repository.ts` |
| Rewrite | `server/finance/account/account.schema.ts` |
| Rewrite | `server/finance/account/account.repository.ts` |
| Rewrite | `server/inventory/item/item.schema.ts` |
| Rewrite | `server/inventory/item/item.repository.ts` |
| Rewrite | `server/inventory/stock/stock.schema.ts` |
| Rewrite | `server/inventory/stock/stock.repository.ts` |
| Rewrite | `server/inventory/order/item/item.schema.ts` |
| Rewrite | `server/inventory/order/item/item.repository.ts` |
| Rewrite | `server/inventory/order/order.schema.ts` |
| Rewrite | `server/inventory/order/order.repository.ts` |
| Rewrite | `server/inventory/adjustment/item/item.schema.ts` |
| Rewrite | `server/inventory/adjustment/item/item.repository.ts` |
| Rewrite | `server/inventory/adjustment/adjustment.schema.ts` |
| Rewrite | `server/inventory/adjustment/adjustment.repository.ts` |
| Rewrite | `server/inventory/transfer/item/item.schema.ts` |
| Rewrite | `server/inventory/transfer/item/item.repository.ts` |
| Rewrite | `server/inventory/transfer/transfer.schema.ts` |
| Rewrite | `server/inventory/transfer/transfer.repository.ts` |
| Modify | `main/background.ts` |
| Modify | `package.json` |

---

## Task 1: Update packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove old deps and add new ones**

Run from the project root:
```bash
npm uninstall typeorm better-sqlite3 @types/better-sqlite3
npm install mongoose @typegoose/typegoose
```

- [ ] **Step 2: Remove asarUnpack from package.json**

In `package.json`, find and remove this line from the `build` section:
```json
"asarUnpack": [
  "**/node_modules/better-sqlite3/**/*"
],
```

- [ ] **Step 3: Verify package.json no longer references SQLite or TypeORM**

Run:
```bash
grep -E "typeorm|better-sqlite3" package.json
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap typeorm/sqlite for mongoose/typegoose"
```

---

## Task 2: Database connection layer

**Files:**
- Create: `server/database/database.ts`
- Rewrite: `server/database/schema.ts`
- Rewrite: `server/database/repository.ts`
- Delete: `server/database/data-source.ts`

- [ ] **Step 1: Create `server/database/database.ts`**

```typescript
import mongoose from 'mongoose';

export const connectDatabase = async (): Promise<void> => {
    await mongoose.connect('mongodb://localhost:27017/mabizpos');
};
```

- [ ] **Step 2: Rewrite `server/database/schema.ts`**

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

- [ ] **Step 3: Rewrite `server/database/repository.ts`**

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
        const doc = await this.model.create({ ...data, createdAt: now, updatedAt: now });
        return doc;
    }

    async update(id: string, data: UpdateQuery<T>): Promise<boolean> {
        const result = await this.model.updateOne(
            { _id: new Types.ObjectId(id) },
            { ...(data as object), updatedAt: Date.now() }
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

- [ ] **Step 4: Delete `server/database/data-source.ts`**

```bash
rm server/database/data-source.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/database/
git commit -m "feat: replace typeorm data-source with mongoose connection and base repo"
```

---

## Task 3: Base service layer

**Files:**
- Rewrite: `server/services/service.ts`

- [ ] **Step 1: Rewrite `server/services/service.ts`**

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

    async create(data: Partial<T>): Promise<DocumentType<T>> {
        return this.repo.create(data);
    }

    async getById(id: string): Promise<DocumentType<T> | null> {
        return this.repo.findById(id);
    }

    async getAll(sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]> {
        return this.repo.findAll(sort);
    }

    async find(filter: FilterQuery<T>, sort?: Record<string, 1 | -1>): Promise<DocumentType<T>[]> {
        return this.repo.find(filter, sort);
    }

    async findOne(filter: FilterQuery<T>): Promise<DocumentType<T> | null> {
        return this.repo.findOne(filter);
    }

    async page(input: PageInput, filter?: FilterQuery<T>): Promise<PageResult<DocumentType<T>>> {
        return this.repo.page(input, filter);
    }

    async update(id: string, data: UpdateQuery<T>): Promise<boolean> {
        return this.repo.update(id, data);
    }

    async delete(id: string): Promise<boolean> {
        return this.repo.delete(id);
    }

    async count(filter?: FilterQuery<T>): Promise<number> {
        return this.repo.count(filter);
    }

    async exists(filter: FilterQuery<T>): Promise<boolean> {
        return this.repo.exists(filter);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/service.ts
git commit -m "feat: replace typeorm types with mongoose types in base service"
```

---

## Task 4: User schema + repository

**Files:**
- Rewrite: `server/user/user.schema.ts`
- Rewrite: `server/user/user.repository.ts`

- [ ] **Step 1: Rewrite `server/user/user.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { BaseSchema } from '../database/schema';

@modelOptions({ schemaOptions: { collection: 'users' } })
@index({ email: 1 }, { unique: true })
@index({ role: 1 })
@index({ remoteId: 1 })
export class User extends BaseSchema {
    @prop({ required: true, unique: true })
    email: string;

    @prop()
    phone?: string;

    @prop({ required: true })
    firstName: string;

    @prop({ required: true })
    lastName: string;

    @prop()
    passwordHash?: string;

    @prop()
    pin?: string;

    @prop({ default: 'cashier' })
    role: 'admin' | 'manager' | 'cashier';

    @prop({ unique: true, sparse: true })
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;

    @prop({ default: true })
    active: boolean;
}
```

- [ ] **Step 2: Rewrite `server/user/user.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass } from '@typegoose/typegoose';
import { AbstractBaseRepository } from '../database/repository';
import { User } from './user.schema';

@injectable()
export class UserRepository extends AbstractBaseRepository<User> {
    constructor() {
        super(getModelForClass(User));
    }

    async findByEmail(email: string) {
        return this.model.findOne({ email }).exec();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/user/
git commit -m "feat: migrate user schema and repository to typegoose"
```

---

## Task 5: License schema + repository

**Files:**
- Rewrite: `server/license/license.schema.ts`
- Rewrite: `server/license/license.repository.ts`

Note: `LicenseRepository` does not extend `AbstractBaseRepository` — it has its own upsert logic. Keep that behaviour, just replace the TypeORM datasource call with a Mongoose model.

- [ ] **Step 1: Rewrite `server/license/license.schema.ts`**

```typescript
import { prop, modelOptions } from '@typegoose/typegoose';
import { BaseSchema } from '../database/schema';

@modelOptions({ schemaOptions: { collection: 'license' } })
export class License extends BaseSchema {
    @prop()
    licenseKey?: string;

    @prop()
    companyId?: string;

    @prop()
    companyName?: string;

    @prop()
    planKey?: string;

    @prop()
    features?: string;

    @prop({ default: 1 })
    maxUsers: number;

    @prop({ default: 1 })
    maxStores: number;

    @prop({ default: () => Date.now() })
    activatedAt: number;

    @prop({ default: () => Date.now() })
    expiresAt: number;

    @prop()
    lastValidatedAt?: number;

    @prop({ default: 'trial' })
    status: 'trial' | 'active' | 'expired' | 'revoked';

    @prop({ default: false })
    isTrial: boolean;

    @prop()
    machineId?: string;
}
```

- [ ] **Step 2: Rewrite `server/license/license.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { License } from './license.schema';

@injectable()
export class LicenseRepository {
    private model = getModelForClass(License);

    async getActiveLicense(): Promise<DocumentType<License> | null> {
        return this.model.findOne().sort({ activatedAt: -1 }).exec();
    }

    async saveLicense(data: Partial<License>): Promise<DocumentType<License>> {
        const existing = await this.getActiveLicense();
        const now = Date.now();

        if (existing) {
            Object.assign(existing, data, { updatedAt: now });
            return existing.save();
        }

        return this.model.create({
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: data.updatedAt ?? now,
            activatedAt: data.activatedAt ?? now,
            expiresAt: data.expiresAt ?? now,
        });
    }

    async clearLicense(): Promise<void> {
        await this.model.deleteMany({}).exec();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/license/
git commit -m "feat: migrate license schema and repository to typegoose"
```

---

## Task 6: ItemType + ItemGroup schemas + repositories

**Files:**
- Rewrite: `server/inventory/item/type/type.schema.ts`
- Rewrite: `server/inventory/item/type/type.repository.ts`
- Rewrite: `server/inventory/item/group/group.schema.ts`
- Rewrite: `server/inventory/item/group/group.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/item/type/type.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { BaseSchema } from '../../../database/schema';

@modelOptions({ schemaOptions: { collection: 'item_types' } })
@index({ name: 1 })
export class ItemType extends BaseSchema {
    @prop({ required: true })
    name: string;

    @prop({ default: false })
    isInventoryItem: boolean;

    @prop()
    description?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/item/type/type.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass } from '@typegoose/typegoose';
import { AbstractBaseRepository } from '../../../database/repository';
import { ItemType } from './type.schema';

@injectable()
export class ItemTypeRepository extends AbstractBaseRepository<ItemType> {
    constructor() {
        super(getModelForClass(ItemType));
    }

    async search(keyword: string) {
        return this.model.find({ name: { $regex: keyword, $options: 'i' } }).sort({ name: 1 }).exec();
    }
}
```

- [ ] **Step 3: Rewrite `server/inventory/item/group/group.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { BaseSchema } from '../../../database/schema';

@modelOptions({ schemaOptions: { collection: 'item_groups' } })
@index({ name: 1 })
export class ItemGroup extends BaseSchema {
    @prop({ required: true })
    name: string;

    @prop()
    code?: string;

    @prop()
    description?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 4: Rewrite `server/inventory/item/group/group.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass } from '@typegoose/typegoose';
import { AbstractBaseRepository } from '../../../database/repository';
import { ItemGroup } from './group.schema';

@injectable()
export class ItemGroupRepository extends AbstractBaseRepository<ItemGroup> {
    constructor() {
        super(getModelForClass(ItemGroup));
    }

    async search(keyword: string) {
        return this.model.find({ name: { $regex: keyword, $options: 'i' } }).sort({ name: 1 }).exec();
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add server/inventory/item/type/ server/inventory/item/group/
git commit -m "feat: migrate item-type and item-group to typegoose"
```

---

## Task 7: Master schema + repository

**Files:**
- Rewrite: `server/master/master.schema.ts`
- Rewrite: `server/master/master.repository.ts`

Note: `parentId` was a string in SQLite but is now `Types.ObjectId`. `MasterRepository.findParentWithChildren` calls `findByParentId(parent._id.toString())` — the `.toString()` call is needed because `_id` is now `ObjectId`.

- [ ] **Step 1: Rewrite `server/master/master.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../database/schema';

@modelOptions({ schemaOptions: { collection: 'masters' } })
@index({ key: 1 })
@index({ parentId: 1 })
@index({ name: 1 })
export class Master extends BaseSchema {
    @prop({ required: true })
    name: string;

    @prop()
    key?: string;

    @prop({ type: Types.ObjectId })
    parentId?: Types.ObjectId;

    @prop()
    description?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/master/master.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../database/repository';
import { Master } from './master.schema';

@injectable()
export class MasterRepository extends AbstractBaseRepository<Master> {
    constructor() {
        super(getModelForClass(Master));
    }

    async findByKey(key: string): Promise<DocumentType<Master> | null> {
        return this.model.findOne({ key }).exec();
    }

    async findByParentId(parentId: string): Promise<DocumentType<Master>[]> {
        return this.model.find({ parentId: new Types.ObjectId(parentId) }).sort({ name: 1 }).exec();
    }

    async findByRemoteId(remoteId: string): Promise<DocumentType<Master> | null> {
        return this.model.findOne({ remoteId }).exec();
    }

    async search(keyword: string): Promise<DocumentType<Master>[]> {
        return this.model.find({
            $or: [
                { name: { $regex: keyword, $options: 'i' } },
                { key: { $regex: keyword, $options: 'i' } },
            ],
        }).sort({ name: 1 }).exec();
    }

    async findParents(): Promise<DocumentType<Master>[]> {
        return this.model.find({ parentId: { $exists: false } }).sort({ name: 1 }).exec();
    }

    async findParentWithChildren(key: string): Promise<{ parent: DocumentType<Master>; children: DocumentType<Master>[] } | null> {
        const parent = await this.findByKey(key);
        if (!parent) return null;
        const children = await this.findByParentId(parent._id.toString());
        return { parent, children };
    }
}
```

- [ ] **Step 3: Fix `server/master/master.service.ts` — one line change**

`getAllWithChildren()` passes `parent._id` (now `Types.ObjectId`) to `findByParentId` which expects a string. Find this line:

```typescript
const children = await this.repo.findByParentId(parent._id);
```

Replace with:

```typescript
const children = await this.repo.findByParentId(parent._id.toString());
```

- [ ] **Step 4: Commit**

```bash
git add server/master/
git commit -m "feat: migrate master schema and repository to typegoose"
```

---

## Task 8: Store schema + repository

**Files:**
- Rewrite: `server/store/store.schema.ts`
- Rewrite: `server/store/store.repository.ts`

- [ ] **Step 1: Rewrite `server/store/store.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { BaseSchema } from '../database/schema';

@modelOptions({ schemaOptions: { collection: 'stores' } })
@index({ name: 1 })
@index({ remoteId: 1 })
export class Store extends BaseSchema {
    @prop({ required: true })
    name: string;

    @prop()
    description?: string;

    @prop()
    address?: string;

    @prop()
    phone?: string;

    @prop({ default: false })
    isActive: boolean;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/store/store.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { AbstractBaseRepository, PageInput, PageResult } from '../database/repository';
import { Store } from './store.schema';

export interface StoreFilterInput {
    keyword?: string;
}

@injectable()
export class StoreRepository extends AbstractBaseRepository<Store> {
    constructor() {
        super(getModelForClass(Store));
    }

    async findByName(name: string): Promise<DocumentType<Store> | null> {
        return this.model.findOne({ name }).exec();
    }

    async findByRemoteId(remoteId: string): Promise<DocumentType<Store> | null> {
        return this.model.findOne({ remoteId }).exec();
    }

    async search(keyword: string): Promise<DocumentType<Store>[]> {
        return this.model.find({
            $or: [
                { name: { $regex: keyword, $options: 'i' } },
                { address: { $regex: keyword, $options: 'i' } },
            ],
        }).sort({ name: 1 }).exec();
    }

    async pageWithFilters(input: PageInput, filters?: StoreFilterInput): Promise<PageResult<DocumentType<Store>>> {
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        const sort: Record<string, 1 | -1> = input.sort
            ? { [input.sort]: input.sortDir === 'ASC' ? 1 : -1 }
            : { createdAt: -1 };

        const filter: any = {};
        if (filters?.keyword) {
            filter.$or = [
                { name: { $regex: filters.keyword, $options: 'i' } },
                { address: { $regex: filters.keyword, $options: 'i' } },
            ];
        }

        const [data, total] = await Promise.all([
            this.model.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).exec(),
            this.model.countDocuments(filter).exec(),
        ]);

        return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/store/
git commit -m "feat: migrate store schema and repository to typegoose"
```

---

## Task 9: Account schema + repository

**Files:**
- Rewrite: `server/finance/account/account.schema.ts`
- Rewrite: `server/finance/account/account.repository.ts`

- [ ] **Step 1: Rewrite `server/finance/account/account.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { BaseSchema } from '../../database/schema';

@modelOptions({ schemaOptions: { collection: 'finance_accounts' } })
@index({ accountName: 1 })
@index({ remoteId: 1 })
export class Account extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true })
    accountName: string;

    @prop()
    accountNumber?: string;

    @prop()
    accountType?: string;

    @prop()
    description?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/finance/account/account.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { AbstractBaseRepository, PageInput, PageResult } from '../../database/repository';
import { Account } from './account.schema';

export interface AccountFilterInput {
    keyword?: string;
    accountType?: string;
}

@injectable()
export class AccountRepository extends AbstractBaseRepository<Account> {
    constructor() {
        super(getModelForClass(Account));
    }

    async findByRemoteId(remoteId: string): Promise<DocumentType<Account> | null> {
        return this.model.findOne({ remoteId }).exec();
    }

    async search(keyword: string): Promise<DocumentType<Account>[]> {
        return this.model.find({
            $or: [
                { accountName: { $regex: keyword, $options: 'i' } },
                { accountNumber: { $regex: keyword, $options: 'i' } },
                { ref: { $regex: keyword, $options: 'i' } },
            ],
        }).sort({ accountName: 1 }).limit(50).exec();
    }

    async pageWithFilters(input: PageInput, filters?: AccountFilterInput): Promise<PageResult<DocumentType<Account>>> {
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        const sort: Record<string, 1 | -1> = input.sort
            ? { [input.sort]: input.sortDir === 'ASC' ? 1 : -1 }
            : { accountName: 1 };

        const filter: any = {};
        if (filters?.accountType) filter.accountType = filters.accountType;
        if (filters?.keyword) {
            filter.$or = [
                { accountName: { $regex: filters.keyword, $options: 'i' } },
                { accountNumber: { $regex: filters.keyword, $options: 'i' } },
                { ref: { $regex: filters.keyword, $options: 'i' } },
            ];
        }

        const [data, total] = await Promise.all([
            this.model.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).exec(),
            this.model.countDocuments(filter).exec(),
        ]);

        return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/finance/
git commit -m "feat: migrate account schema and repository to typegoose"
```

---

## Task 10: Item schema + repository

**Files:**
- Rewrite: `server/inventory/item/item.schema.ts`
- Rewrite: `server/inventory/item/item.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/item/item.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../database/schema';
import { ItemSoldByTypes, ItemStatusTypes } from '../constants';

@modelOptions({ schemaOptions: { collection: 'items_inventory' } })
@index({ name: 1 })
@index({ status: 1 })
@index({ categoryId: 1 })
@index({ typeId: 1 })
@index({ remoteId: 1 })
export class Item extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true })
    name: string;

    @prop()
    shortName?: string;

    @prop()
    slug?: string;

    @prop()
    description?: string;

    @prop()
    keywords?: string;

    @prop({ default: 0 })
    price: number;

    @prop({ default: 0 })
    rate: number;

    @prop({ default: 0 })
    cost: number;

    @prop({ default: 0 })
    stockIn: number;

    @prop({ default: 0 })
    stockOut: number;

    @prop({ default: 0 })
    netQuantity: number;

    @prop({ default: 0 })
    grossQuantity: number;

    @prop({ default: ItemSoldByTypes.QUANTITY })
    soldBy: ItemSoldByTypes;

    @prop({ type: Types.ObjectId })
    categoryId?: Types.ObjectId;

    @prop()
    categoryName?: string;

    @prop({ type: Types.ObjectId })
    typeId?: Types.ObjectId;

    @prop()
    typeName?: string;

    @prop({ type: Types.ObjectId })
    groupId?: Types.ObjectId;

    @prop()
    groupName?: string;

    @prop({ type: Types.ObjectId })
    uomId?: Types.ObjectId;

    @prop()
    uomName?: string;

    @prop({ type: Types.ObjectId })
    salesAccountId?: Types.ObjectId;

    @prop()
    salesAccountName?: string;

    @prop({ type: Types.ObjectId })
    costOfSalesAccountId?: Types.ObjectId;

    @prop()
    costOfSalesAccountName?: string;

    @prop({ type: Types.ObjectId })
    inventoryAccountId?: Types.ObjectId;

    @prop()
    inventoryAccountName?: string;

    @prop({ type: () => [Object] })
    subItems?: any[];

    @prop({ type: Types.ObjectId })
    parentId?: Types.ObjectId;

    @prop({ default: ItemStatusTypes.ONLINE })
    status: ItemStatusTypes;

    @prop({ default: false })
    costByAverage: boolean;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/item/item.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository, PageInput, PageResult } from '../../database/repository';
import { Item } from './item.schema';

export interface ItemFilterInput {
    keyword?: string;
    categoryId?: string;
    typeId?: string;
    groupId?: string;
    status?: string;
}

@injectable()
export class ItemRepository extends AbstractBaseRepository<Item> {
    constructor() {
        super(getModelForClass(Item));
    }

    async findByName(name: string): Promise<DocumentType<Item> | null> {
        return this.model.findOne({ name }).exec();
    }

    async findByRemoteId(remoteId: string): Promise<DocumentType<Item> | null> {
        return this.model.findOne({ remoteId }).exec();
    }

    async search(keyword: string): Promise<DocumentType<Item>[]> {
        return this.model.find({
            $or: [
                { name: { $regex: keyword, $options: 'i' } },
                { shortName: { $regex: keyword, $options: 'i' } },
                { ref: { $regex: keyword, $options: 'i' } },
            ],
        }).sort({ name: 1 }).exec();
    }

    async pageWithFilters(input: PageInput, filters?: ItemFilterInput): Promise<PageResult<DocumentType<Item>>> {
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        const sort: Record<string, 1 | -1> = input.sort
            ? { [input.sort]: input.sortDir === 'ASC' ? 1 : -1 }
            : { createdAt: -1 };

        const filter: any = {};
        if (filters?.categoryId) filter.categoryId = new Types.ObjectId(filters.categoryId);
        if (filters?.typeId) filter.typeId = new Types.ObjectId(filters.typeId);
        if (filters?.groupId) filter.groupId = new Types.ObjectId(filters.groupId);
        if (filters?.status) filter.status = filters.status;
        if (filters?.keyword) {
            filter.$or = [
                { name: { $regex: filters.keyword, $options: 'i' } },
                { shortName: { $regex: filters.keyword, $options: 'i' } },
                { ref: { $regex: filters.keyword, $options: 'i' } },
            ];
        }

        const [data, total] = await Promise.all([
            this.model.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).exec(),
            this.model.countDocuments(filter).exec(),
        ]);

        return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/inventory/item/item.schema.ts server/inventory/item/item.repository.ts
git commit -m "feat: migrate item schema and repository to typegoose"
```

---

## Task 11: Stock schema + repository

**Files:**
- Rewrite: `server/inventory/stock/stock.schema.ts`
- Rewrite: `server/inventory/stock/stock.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/stock/stock.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../database/schema';
import { ItemSoldByTypes, StockKindTypes, StockStatus, StockTypes } from '../constants';

@modelOptions({ schemaOptions: { collection: 'stocks' } })
@index({ itemId: 1 })
@index({ storeId: 1 })
@index({ type: 1 })
@index({ kind: 1 })
export class Stock extends BaseSchema {
    @prop({ type: Types.ObjectId })
    orderId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    orderItemId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    storeId?: Types.ObjectId;

    @prop({ required: true, type: Types.ObjectId })
    itemId: Types.ObjectId;

    @prop()
    itemName?: string;

    @prop({ type: Types.ObjectId })
    lastStockId?: Types.ObjectId;

    @prop({ default: StockStatus.Available })
    status: StockStatus;

    @prop({ required: true })
    type: StockTypes;

    @prop({ required: true })
    kind: StockKindTypes;

    @prop({ default: ItemSoldByTypes.ITEM })
    soldBy: ItemSoldByTypes;

    @prop({ default: 0 })
    grossQuantity: number;

    @prop({ default: 0 })
    netQuantity: number;

    @prop({ default: 0 })
    wasteQuantity: number;

    @prop({ default: 0 })
    cost: number;

    @prop({ default: 0 })
    avgCost: number;

    @prop({ default: 0 })
    soldAt: number;

    @prop({ default: 0 })
    weightSold: number;

    @prop({ default: true })
    fixed: boolean;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/stock/stock.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../../database/repository';
import { Stock } from './stock.schema';

@injectable()
export class StockRepository extends AbstractBaseRepository<Stock> {
    constructor() {
        super(getModelForClass(Stock));
    }

    async findByItemId(itemId: string): Promise<DocumentType<Stock>[]> {
        return this.model.find({ itemId: new Types.ObjectId(itemId) }).exec();
    }

    async findByOrderId(orderId: string): Promise<DocumentType<Stock>[]> {
        return this.model.find({ orderId: new Types.ObjectId(orderId) }).exec();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/inventory/stock/
git commit -m "feat: migrate stock schema and repository to typegoose"
```

---

## Task 12: OrderItem schema + repository

**Files:**
- Rewrite: `server/inventory/order/item/item.schema.ts`
- Rewrite: `server/inventory/order/item/item.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/order/item/item.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../../database/schema';
import { OrderKindTypes, OrderPaymentStatusTypes } from '../../constants';

@modelOptions({ schemaOptions: { collection: 'order_items' } })
@index({ orderId: 1 })
@index({ itemId: 1 })
export class OrderItem extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true, type: Types.ObjectId })
    orderId: Types.ObjectId;

    @prop({ required: true })
    kind: OrderKindTypes;

    @prop({ required: true, type: Types.ObjectId })
    itemId: Types.ObjectId;

    @prop()
    itemName?: string;

    @prop({ type: Types.ObjectId })
    stockId?: Types.ObjectId;

    @prop({ default: 0 })
    grossQuantity: number;

    @prop({ default: 0 })
    netQuantity: number;

    @prop({ default: 0 })
    wasteQuantity: number;

    @prop({ default: 0 })
    cost: number;

    @prop({ default: 0 })
    rate: number;

    @prop({ default: 1 })
    exchangeRate: number;

    @prop({ default: 0 })
    margin: number;

    @prop({ default: 0 })
    makingCharge: number;

    @prop({ default: true })
    fixed: boolean;

    @prop({ default: 0 })
    amount: number;

    @prop({ default: OrderPaymentStatusTypes.PENDING })
    paymentStatus: OrderPaymentStatusTypes;

    @prop({ type: Types.ObjectId })
    taxId?: Types.ObjectId;

    @prop({ default: false })
    taxInclusive: boolean;

    @prop({ default: 0 })
    taxAmount: number;

    @prop({ type: Types.ObjectId })
    costCenterId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    classId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    analysisCodeId?: Types.ObjectId;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/order/item/item.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../../../database/repository';
import { OrderItem } from './item.schema';

@injectable()
export class OrderItemRepository extends AbstractBaseRepository<OrderItem> {
    constructor() {
        super(getModelForClass(OrderItem));
    }

    async findByOrderId(orderId: string): Promise<DocumentType<OrderItem>[]> {
        return this.model.find({ orderId: new Types.ObjectId(orderId) }).sort({ createdAt: 1 }).exec();
    }

    async deleteByOrderId(orderId: string): Promise<void> {
        await this.model.deleteMany({ orderId: new Types.ObjectId(orderId) }).exec();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/inventory/order/item/
git commit -m "feat: migrate order-item schema and repository to typegoose"
```

---

## Task 13: Order schema + repository

**Files:**
- Rewrite: `server/inventory/order/order.schema.ts`
- Rewrite: `server/inventory/order/order.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/order/order.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../database/schema';
import {
    OrderDiscountValueType,
    OrderKindTypes,
    OrderPaymentMethodTypes,
    OrderPaymentStatusTypes,
    OrderPaymentType,
    OrderStatusTypes,
} from '../constants';

@modelOptions({ schemaOptions: { collection: 'orders' } })
@index({ kind: 1 })
@index({ status: 1 })
@index({ customerId: 1 })
@index({ supplierId: 1 })
@index({ remoteId: 1 })
export class Order extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true })
    kind: OrderKindTypes;

    @prop({ type: Types.ObjectId })
    parentId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    customerId?: Types.ObjectId;

    @prop()
    customerName?: string;

    @prop({ type: Types.ObjectId })
    supplierId?: Types.ObjectId;

    @prop()
    supplierName?: string;

    @prop({ type: Types.ObjectId })
    storeId?: Types.ObjectId;

    @prop({ default: OrderPaymentType.CASH })
    paymentType: OrderPaymentType;

    @prop({ default: OrderPaymentMethodTypes.CASH })
    paymentMethod: OrderPaymentMethodTypes;

    @prop({ default: 0 })
    totalAmount: number;

    @prop({ default: 0 })
    totalAmountPaid: number;

    @prop({ default: 0 })
    cashAmount: number;

    @prop({ default: 0 })
    bankAmount: number;

    @prop()
    discountValueType?: OrderDiscountValueType;

    @prop({ default: 0 })
    discountValue: number;

    @prop({ default: 0 })
    discountAmount: number;

    @prop()
    note?: string;

    @prop({ default: true })
    fixed: boolean;

    @prop()
    fixedDate?: number;

    @prop({ default: OrderStatusTypes.SAVED })
    status: OrderStatusTypes;

    @prop({ default: OrderPaymentStatusTypes.PENDING })
    paymentStatus: OrderPaymentStatusTypes;

    @prop()
    orderDate?: number;

    @prop()
    completedAt?: number;

    @prop()
    completedBy?: string;

    @prop({ default: 1 })
    exchangeRate: number;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/order/order.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../../database/repository';
import { Order } from './order.schema';

@injectable()
export class OrderRepository extends AbstractBaseRepository<Order> {
    constructor() {
        super(getModelForClass(Order));
    }

    async findByKind(kind: string): Promise<DocumentType<Order>[]> {
        return this.model.find({ kind }).sort({ createdAt: -1 }).exec();
    }

    async findByCustomerId(customerId: string): Promise<DocumentType<Order>[]> {
        return this.model.find({ customerId: new Types.ObjectId(customerId) }).exec();
    }

    async findBySupplierId(supplierId: string): Promise<DocumentType<Order>[]> {
        return this.model.find({ supplierId: new Types.ObjectId(supplierId) }).exec();
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/inventory/order/order.schema.ts server/inventory/order/order.repository.ts
git commit -m "feat: migrate order schema and repository to typegoose"
```

---

## Task 14: Adjustment schema + repository

**Files:**
- Rewrite: `server/inventory/adjustment/item/item.schema.ts`
- Rewrite: `server/inventory/adjustment/item/item.repository.ts`
- Rewrite: `server/inventory/adjustment/adjustment.schema.ts`
- Rewrite: `server/inventory/adjustment/adjustment.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/adjustment/item/item.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../../database/schema';

@modelOptions({ schemaOptions: { collection: 'stock_adjustment_items' } })
@index({ adjustmentId: 1 })
@index({ itemId: 1 })
export class StockAdjustmentItem extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true, type: Types.ObjectId })
    adjustmentId: Types.ObjectId;

    @prop({ required: true, type: Types.ObjectId })
    itemId: Types.ObjectId;

    @prop()
    itemName?: string;

    @prop({ type: Types.ObjectId })
    storeId?: Types.ObjectId;

    @prop({ default: 0 })
    cost: number;

    @prop({ default: 0 })
    quantity: number;

    @prop({ default: 0 })
    newQuantity: number;

    @prop({ default: 0 })
    diff: number;

    @prop()
    description?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/adjustment/item/item.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../../../database/repository';
import { StockAdjustmentItem } from './item.schema';

@injectable()
export class AdjustmentItemRepository extends AbstractBaseRepository<StockAdjustmentItem> {
    constructor() {
        super(getModelForClass(StockAdjustmentItem));
    }

    async findByAdjustmentId(adjustmentId: string): Promise<DocumentType<StockAdjustmentItem>[]> {
        return this.model.find({ adjustmentId: new Types.ObjectId(adjustmentId) }).sort({ createdAt: 1 }).exec();
    }

    async deleteByAdjustmentId(adjustmentId: string): Promise<void> {
        await this.model.deleteMany({ adjustmentId: new Types.ObjectId(adjustmentId) }).exec();
    }
}
```

- [ ] **Step 3: Rewrite `server/inventory/adjustment/adjustment.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../database/schema';
import { StockAdjustmentTypes } from '../constants';

@modelOptions({ schemaOptions: { collection: 'stock_adjustments' } })
@index({ storeId: 1 })
export class StockAdjustment extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ type: Types.ObjectId })
    storeId?: Types.ObjectId;

    @prop({ type: Types.ObjectId })
    accountId?: Types.ObjectId;

    @prop()
    accountName?: string;

    @prop({ default: StockAdjustmentTypes.QUANTITY })
    type: StockAdjustmentTypes;

    @prop()
    note?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 4: Rewrite `server/inventory/adjustment/adjustment.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass } from '@typegoose/typegoose';
import { AbstractBaseRepository } from '../../database/repository';
import { StockAdjustment } from './adjustment.schema';

@injectable()
export class AdjustmentRepository extends AbstractBaseRepository<StockAdjustment> {
    constructor() {
        super(getModelForClass(StockAdjustment));
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add server/inventory/adjustment/
git commit -m "feat: migrate adjustment schema and repository to typegoose"
```

---

## Task 15: Transfer schema + repository

**Files:**
- Rewrite: `server/inventory/transfer/item/item.schema.ts`
- Rewrite: `server/inventory/transfer/item/item.repository.ts`
- Rewrite: `server/inventory/transfer/transfer.schema.ts`
- Rewrite: `server/inventory/transfer/transfer.repository.ts`

- [ ] **Step 1: Rewrite `server/inventory/transfer/item/item.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../../database/schema';

@modelOptions({ schemaOptions: { collection: 'stock_transfer_items' } })
@index({ transferId: 1 })
@index({ itemId: 1 })
export class StockTransferItem extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true, type: Types.ObjectId })
    transferId: Types.ObjectId;

    @prop({ required: true, type: Types.ObjectId })
    itemId: Types.ObjectId;

    @prop()
    itemName?: string;

    @prop({ default: 0 })
    quantity: number;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 2: Rewrite `server/inventory/transfer/item/item.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass, DocumentType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { AbstractBaseRepository } from '../../../database/repository';
import { StockTransferItem } from './item.schema';

@injectable()
export class TransferItemRepository extends AbstractBaseRepository<StockTransferItem> {
    constructor() {
        super(getModelForClass(StockTransferItem));
    }

    async findByTransferId(transferId: string): Promise<DocumentType<StockTransferItem>[]> {
        return this.model.find({ transferId: new Types.ObjectId(transferId) }).sort({ createdAt: 1 }).exec();
    }

    async deleteByTransferId(transferId: string): Promise<void> {
        await this.model.deleteMany({ transferId: new Types.ObjectId(transferId) }).exec();
    }
}
```

- [ ] **Step 3: Rewrite `server/inventory/transfer/transfer.schema.ts`**

```typescript
import { prop, modelOptions, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { BaseSchema } from '../../database/schema';

@modelOptions({ schemaOptions: { collection: 'stock_transfers' } })
@index({ fromStoreId: 1 })
@index({ toStoreId: 1 })
export class StockTransfer extends BaseSchema {
    @prop()
    ref?: string;

    @prop({ required: true, type: Types.ObjectId })
    fromStoreId: Types.ObjectId;

    @prop()
    fromStoreName?: string;

    @prop({ required: true, type: Types.ObjectId })
    toStoreId: Types.ObjectId;

    @prop()
    toStoreName?: string;

    @prop()
    note?: string;

    @prop()
    remoteId?: string;

    @prop({ default: false })
    synced: boolean;
}
```

- [ ] **Step 4: Rewrite `server/inventory/transfer/transfer.repository.ts`**

```typescript
import { injectable } from 'tsyringe';
import { getModelForClass } from '@typegoose/typegoose';
import { AbstractBaseRepository } from '../../database/repository';
import { StockTransfer } from './transfer.schema';

@injectable()
export class TransferRepository extends AbstractBaseRepository<StockTransfer> {
    constructor() {
        super(getModelForClass(StockTransfer));
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add server/inventory/transfer/
git commit -m "feat: migrate transfer schema and repository to typegoose"
```

---

## Task 16: Wire up background.ts

**Files:**
- Modify: `main/background.ts`

- [ ] **Step 1: Replace the data-source import and call in `main/background.ts`**

Find these two lines:
```typescript
import { getDataSource } from '../server/database/data-source';
// ... later in app.whenReady():
await getDataSource();
```

Replace with:
```typescript
import { connectDatabase } from '../server/database/database';
// ... later in app.whenReady():
await connectDatabase();
```

The `app.whenReady()` block becomes:
```typescript
app.whenReady().then(async () => {
    // Initialize database
    await connectDatabase();

    // Resolve DI after app is ready and DB is initialized
    userService = container.resolve(UserService);
    // ... rest unchanged
```

- [ ] **Step 2: Commit**

```bash
git add main/background.ts
git commit -m "feat: wire background.ts to connectDatabase"
```

---

## Task 17: Smoke test — start the app

- [ ] **Step 1: Make sure MongoDB is running**

```bash
mongosh --eval "db.adminCommand('ping')"
```
Expected output:
```
{ ok: 1 }
```

If not running (macOS): `brew services start mongodb-community`
If not running (Windows): `net start MongoDB`

- [ ] **Step 2: Start the app in dev mode**

```bash
npm run dev
```

Expected: app opens, no errors in terminal about connection or missing modules.

- [ ] **Step 3: Verify MongoDB collections are created**

In a separate terminal:
```bash
mongosh mabizpos --eval "db.getCollectionNames()"
```

Expected: after the app seeds master data and the default user, you should see collections including `masters` and `users`:
```
[ 'masters', 'users' ]
```

- [ ] **Step 4: Verify master seed data exists**

```bash
mongosh mabizpos --eval "db.masters.countDocuments()"
```
Expected: `> 0` (seed data from `MasterService.seed()`)

- [ ] **Step 5: Verify sign-in works**

In the app UI, attempt to sign in with the default credentials. Confirm the app loads the main screen without errors.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete sqlite-to-mongodb typegoose migration"
```
