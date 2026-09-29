// The book the course UI is showing. CourseApp provides it; components deep in
// the tree (exercise cards saving progress) read it instead of threading the
// id through every prop list.

import { createContext, useContext } from "react";
import type { Book } from "./books";

export const BookContext = createContext<Book | null>(null);

export function useBook(): Book {
  const book = useContext(BookContext);
  if (!book) throw new Error("useBook() outside a BookContext provider");
  return book;
}
