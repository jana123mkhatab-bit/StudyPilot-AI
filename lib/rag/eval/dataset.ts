/**
 * Sprint 2 RAG evaluation dataset (spec Phase 24). Pure data — no "server-only" imports — so it
 * can be pulled into a standalone eval runner (scripts/rag-eval.ts) as well as the app itself.
 *
 * All 30 cases are grounded in two real materials seeded by the runner against "Course A"
 * (Database Systems: a lecture on normalization/transactions + a practice-exam document) and one
 * material against an unrelated "Course B" (Computer Networks), so isolation tests have a real
 * course to fail to leak from.
 */

export type EvalCategory =
  | "factual"
  | "cross_document"
  | "previous_exam"
  | "insufficient_evidence"
  | "cross_course_isolation";

export interface EvalCase {
  id: string;
  category: EvalCategory;
  /** Which seeded course this question is asked against. */
  course: "A" | "B";
  question: string;
  /**
   * Behavior the grader checks for:
   * - "grounded": expects citations and at least one expected keyword in the answer
   * - "insufficient_evidence": expects no citations / a hedge, not a confident fabricated answer
   * - "isolated_empty": expects no citations (the question's real answer lives in the OTHER course)
   */
  expectedBehavior: "grounded" | "insufficient_evidence" | "isolated_empty";
  /** Case-insensitive substrings; for "grounded" cases at least one must appear in the answer (a lightweight Recall@K proxy). */
  expectedKeywords?: string[];
  expectedSourceFile?: string;
}

export const COURSE_A_LECTURE = `Lecture 4: Database Normalization

Normalization is the process of organizing columns and tables in a relational database to minimize data redundancy and improve data integrity.

First Normal Form (1NF) requires that all column values be atomic and that each record be unique. A table violates 1NF if it contains repeating groups or multi-valued attributes.

Second Normal Form (2NF) requires the table to be in 1NF and that all non-key attributes be fully functionally dependent on the entire primary key, not just part of it. This mainly matters for composite keys.

Third Normal Form (3NF) requires the table to be in 2NF and that there be no transitive dependencies, meaning non-key attributes must depend only on the primary key and not on other non-key attributes.

Boyce-Codd Normal Form (BCNF) is a stricter version of 3NF where every determinant must be a candidate key.

Lecture 5: Database Transactions

A transaction is a sequence of database operations that are treated as a single logical unit of work. Transactions must satisfy the ACID properties: Atomicity, Consistency, Isolation, and Durability.

Atomicity guarantees that all operations in a transaction complete successfully, or none of them do. If any operation fails, the entire transaction is rolled back.

Isolation ensures that concurrently executing transactions do not interfere with each other, typically enforced through locking or multi-version concurrency control (MVCC).

Durability guarantees that once a transaction is committed, its changes persist even in the event of a system crash, typically implemented via write-ahead logging.`;

export const COURSE_A_PRACTICE_EXAM = `Practice Exam - Database Systems Midterm (Previous Term)

Question 1: A table has columns (StudentID, CourseID, InstructorName) where InstructorName depends only on CourseID, not the full composite key (StudentID, CourseID). Which normal form is violated, and why? This is a partial dependency, which violates Second Normal Form (2NF).

Question 2: Explain why a transaction that updates two bank account balances must be atomic. If the transaction fails after debiting one account but before crediting the other, the entire transaction must be rolled back so no money is lost or created; this is the Atomicity property.

Question 3: A relational schema is in 3NF but not BCNF. Give an example of a determinant that is not a candidate key. For example, in a schema (Student, Advisor, Department) where each Advisor works in exactly one Department, Advisor determines Department but Advisor alone is not a candidate key of the relation.

Question 4: What isolation level would you use to prevent two concurrent transactions from reading uncommitted data from each other, and why does READ UNCOMMITTED violate isolation? READ COMMITTED or stricter prevents dirty reads; READ UNCOMMITTED allows one transaction to see another's uncommitted changes, violating the Isolation property.

Question 5: A backup system guarantees that once a transaction commits, its effects survive a crash. Which ACID property does this describe, and how is it typically implemented? This is Durability, typically implemented using write-ahead logging (WAL).`;

export const COURSE_B_LECTURE = `Lecture 1: Introduction to Computer Networks and the OSI Model

A computer network connects devices so they can exchange data. The OSI model describes networking in seven layers: Physical, Data Link, Network, Transport, Session, Presentation, and Application.

The Physical layer handles raw bit transmission over a medium such as copper cable or radio waves.

The Data Link layer handles framing and node-to-node delivery, using MAC addresses to identify devices on the same local network.

The Network layer is responsible for logical addressing and routing packets between networks, primarily using IP addresses.

The Transport layer provides end-to-end communication; TCP offers reliable, ordered delivery with retransmission, while UDP offers a lighter, connectionless alternative.

Routing algorithms such as distance-vector and link-state protocols determine the best path for a packet to travel across interconnected networks.`;

export const EVAL_DATASET: EvalCase[] = [
  // ---- Factual (10) ----
  { id: "f1", category: "factual", course: "A", question: "What is First Normal Form (1NF) in database normalization?", expectedBehavior: "grounded", expectedKeywords: ["atomic", "1nf"], expectedSourceFile: "lecture-4-5.txt" },
  { id: "f2", category: "factual", course: "A", question: "What does Second Normal Form (2NF) require in addition to 1NF?", expectedBehavior: "grounded", expectedKeywords: ["functionally dependent", "2nf", "primary key"] },
  { id: "f3", category: "factual", course: "A", question: "What is a transitive dependency, and which normal form eliminates it?", expectedBehavior: "grounded", expectedKeywords: ["transitive", "3nf"] },
  { id: "f4", category: "factual", course: "A", question: "What distinguishes BCNF from 3NF?", expectedBehavior: "grounded", expectedKeywords: ["candidate key", "determinant", "bcnf"] },
  { id: "f5", category: "factual", course: "A", question: "What are the four ACID properties of a database transaction?", expectedBehavior: "grounded", expectedKeywords: ["atomicity", "consistency", "isolation", "durability"] },
  { id: "f6", category: "factual", course: "A", question: "What does atomicity guarantee about a transaction?", expectedBehavior: "grounded", expectedKeywords: ["all operations", "rolled back"] },
  { id: "f7", category: "factual", course: "A", question: "How is isolation between concurrent transactions typically enforced?", expectedBehavior: "grounded", expectedKeywords: ["locking", "concurrency"] },
  { id: "f8", category: "factual", course: "A", question: "What does durability guarantee about a committed transaction?", expectedBehavior: "grounded", expectedKeywords: ["persist", "crash"] },
  { id: "f9", category: "factual", course: "A", question: "What is the goal of database normalization?", expectedBehavior: "grounded", expectedKeywords: ["redundancy", "integrity"] },
  { id: "f10", category: "factual", course: "A", question: "What condition causes a table to violate First Normal Form?", expectedBehavior: "grounded", expectedKeywords: ["repeating group", "multi-valued"] },

  // ---- Cross-document (5): needs both the lecture and the practice exam ----
  { id: "cd1", category: "cross_document", course: "A", question: "The practice exam describes a table (StudentID, CourseID, InstructorName) where InstructorName depends only on CourseID. Using the lecture's definitions, which normal form does this violate?", expectedBehavior: "grounded", expectedKeywords: ["2nf", "partial"] },
  { id: "cd2", category: "cross_document", course: "A", question: "The practice exam gives an example of a determinant that isn't a candidate key. What normal-form concept from the lecture does that example illustrate?", expectedBehavior: "grounded", expectedKeywords: ["bcnf", "determinant", "candidate key"] },
  { id: "cd3", category: "cross_document", course: "A", question: "Using both the lecture's definition of atomicity and the practice exam's bank transfer example, explain why a failed transfer must be rolled back.", expectedBehavior: "grounded", expectedKeywords: ["atomicity", "rolled back"] },
  { id: "cd4", category: "cross_document", course: "A", question: "The practice exam asks why READ UNCOMMITTED violates isolation. Which ACID property from the lecture does this relate to?", expectedBehavior: "grounded", expectedKeywords: ["isolation", "uncommitted"] },
  { id: "cd5", category: "cross_document", course: "A", question: "How does the practice exam's durability question connect to what the lecture says durability is implemented with?", expectedBehavior: "grounded", expectedKeywords: ["durability", "write-ahead"] },

  // ---- Previous-exam style (5): phrased the way the practice exam phrases them ----
  { id: "pe1", category: "previous_exam", course: "A", question: "What isolation level prevents transactions from reading uncommitted data from each other?", expectedBehavior: "grounded", expectedKeywords: ["read committed", "isolation"] },
  { id: "pe2", category: "previous_exam", course: "A", question: "How is durability typically implemented in a database system?", expectedBehavior: "grounded", expectedKeywords: ["write-ahead"] },
  { id: "pe3", category: "previous_exam", course: "A", question: "Give an example of a determinant that is not a candidate key in a 3NF-but-not-BCNF schema.", expectedBehavior: "grounded", expectedKeywords: ["determinant", "candidate key"] },
  { id: "pe4", category: "previous_exam", course: "A", question: "What happens if a funds-transfer transaction fails after debiting one account but before crediting another?", expectedBehavior: "grounded", expectedKeywords: ["rolled back"] },
  { id: "pe5", category: "previous_exam", course: "A", question: "Which normal form is violated when a non-key attribute depends on only part of a composite key?", expectedBehavior: "grounded", expectedKeywords: ["2nf", "partial"] },

  // ---- Insufficient evidence (5): real DB topics, but not covered by this course's materials ----
  { id: "ie1", category: "insufficient_evidence", course: "A", question: "What is a B-tree index and how does it speed up query performance?", expectedBehavior: "insufficient_evidence" },
  { id: "ie2", category: "insufficient_evidence", course: "A", question: "Explain the CAP theorem and how it applies to distributed databases.", expectedBehavior: "insufficient_evidence" },
  { id: "ie3", category: "insufficient_evidence", course: "A", question: "How does sharding work in a distributed SQL database?", expectedBehavior: "insufficient_evidence" },
  { id: "ie4", category: "insufficient_evidence", course: "A", question: "What is the exact syntax for a recursive common table expression (CTE) in PostgreSQL?", expectedBehavior: "insufficient_evidence" },
  { id: "ie5", category: "insufficient_evidence", course: "A", question: "What replication lag does MongoDB's oplog typically introduce in a three-node replica set?", expectedBehavior: "insufficient_evidence" },

  // ---- Cross-course isolation (5): Course A's exact topics, asked from inside Course B ----
  { id: "ci1", category: "cross_course_isolation", course: "B", question: "What is Third Normal Form (3NF)?", expectedBehavior: "isolated_empty" },
  { id: "ci2", category: "cross_course_isolation", course: "B", question: "What are the ACID properties of a database transaction?", expectedBehavior: "isolated_empty" },
  { id: "ci3", category: "cross_course_isolation", course: "B", question: "What does BCNF stand for and what does it require?", expectedBehavior: "isolated_empty" },
  { id: "ci4", category: "cross_course_isolation", course: "B", question: "According to the practice exam, why does READ UNCOMMITTED violate isolation?", expectedBehavior: "isolated_empty" },
  { id: "ci5", category: "cross_course_isolation", course: "B", question: "What did the database normalization lecture say about candidate keys?", expectedBehavior: "isolated_empty" },
];
