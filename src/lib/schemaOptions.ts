/* eslint-disable @typescript-eslint/no-explicit-any -- Mongoose types this per model, and it is shared by all. */

/** Every document leaves the API with `id` instead of `_id`, and without `__v`. */
export const jsonOptions = {
  versionKey: false,
  transform: (_doc: any, ret: any) => {
    ret.id = String(ret._id)
    delete ret._id
    return ret
  },
}

export const baseOptions = {
  timestamps: true,
  toJSON: jsonOptions,
  toObject: jsonOptions,
}
