import { model, Schema } from 'mongoose'
import { baseOptions } from '../../lib/schemaOptions.js'

export interface CategoryDoc {
  _id: string
  name: string
  shortName: string
  accent: string
  sortOrder: number
}

export interface DishDoc {
  _id: string
  categoryId: string
  name: string
  description: string
  shortDescription: string
  longDescription?: string
  price: number
  kcal: number
  image: string
  badges: string[]
  allergens: string[]
  optionGroupIds: string[]
  soldOut: boolean
  sortOrder: number
}

export interface OptionChoiceDoc {
  id: string
  label: string
  priceDelta: number
}

export interface OptionGroupDoc {
  _id: string
  title: string
  kind: 'radio' | 'chips' | 'segmented'
  required: boolean
  helperText?: string
  maxChoices: number
  defaultChoiceId?: string
  promptLabel?: string
  choices: OptionChoiceDoc[]
}

const pence = { type: Number, required: true, min: 0, validate: Number.isInteger }

export const Category = model<CategoryDoc>(
  'Category',
  new Schema<CategoryDoc>(
    {
      _id: { type: String, required: true },
      name: { type: String, required: true },
      shortName: { type: String, required: true },
      accent: { type: String, required: true },
      sortOrder: { type: Number, default: 0 },
    },
    baseOptions,
  ),
)

const dishSchema = new Schema<DishDoc>(
  {
    _id: { type: String, required: true },
    categoryId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    shortDescription: { type: String, required: true },
    longDescription: String,
    price: pence,
    kcal: { type: Number, default: 0 },
    image: { type: String, required: true },
    badges: [String],
    allergens: [String],
    optionGroupIds: [String],
    soldOut: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  baseOptions,
)

export const Dish = model<DishDoc>('Dish', dishSchema)

export const OptionGroup = model<OptionGroupDoc>(
  'OptionGroup',
  new Schema<OptionGroupDoc>(
    {
      _id: { type: String, required: true },
      title: { type: String, required: true },
      kind: { type: String, enum: ['radio', 'chips', 'segmented'], default: 'radio' },
      required: { type: Boolean, default: false },
      helperText: String,
      maxChoices: { type: Number, default: 1, min: 1 },
      defaultChoiceId: String,
      promptLabel: String,
      choices: [
        { _id: false, id: { type: String, required: true }, label: String, priceDelta: pence },
      ],
    },
    baseOptions,
  ),
)
