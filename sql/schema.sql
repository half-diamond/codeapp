CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(40) NOT NULL,
  department VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workspaces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(120) NOT NULL,
  language ENUM('cpp', 'python') NOT NULL DEFAULT 'cpp',
  code MEDIUMTEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS problems (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  time_limit_ms INT NOT NULL DEFAULT 2000,
  PRIMARY KEY (id),
  UNIQUE KEY uq_problems_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  problem_id BIGINT UNSIGNED NOT NULL,
  input_data MEDIUMTEXT NOT NULL,
  expected_output MEDIUMTEXT NOT NULL,
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_case_problem_input (problem_id, input_data(128)),
  CONSTRAINT fk_cases_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  problem_id BIGINT UNSIGNED NOT NULL,
  language ENUM('cpp', 'python') NOT NULL,
  code MEDIUMTEXT NOT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'WRONG_ANSWER', 'TLE', 'COMPILATION_ERROR', 'RUNTIME_ERROR') NOT NULL DEFAULT 'PENDING',
  exec_time_ms INT NOT NULL DEFAULT 0,
  worker_node VARCHAR(32) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sub_prob_status_time (problem_id, status, exec_time_ms ASC),
  KEY idx_sub_user_created (user_id, created_at DESC, id DESC),
  KEY idx_sub_created_id (created_at DESC, id DESC),
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sub_problem FOREIGN KEY (problem_id) REFERENCES problems(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO users (id, username, department) VALUES
  (1, 'arya', 'Systems'), (2, 'dev', 'Systems'),
  (3, 'mira', 'Systems'), (4, 'noah', 'Applied Math'),
  (5, 'sana', 'Applied Math'), (6, 'leo', 'Applied Math'),
  (7, 'inez', 'Product'), (8, 'omar', 'Product'),
  (9, 'rui', 'Product')
ON DUPLICATE KEY UPDATE username=VALUES(username), department=VALUES(department);

INSERT INTO workspaces (id, title, language, code, version) VALUES
  (1, 'Starter workspace', 'python', 'data = input().split()\nprint(" ".join(data))\n', 1)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO problems (id, slug, title, description, time_limit_ms) VALUES
  (1, 'two-sum', 'Two Sum', 'Read n, then n integers and a target. Print the two zero-based indices of a pair that sums to the target.', 2000),
  (2, 'max-subarray', 'Maximum Subarray Sum', 'Read n and n integers. Print the maximum sum of a non-empty contiguous subarray.', 2000),
  (3, 'valid-parentheses', 'Valid Parentheses', 'Read one bracket string. Print YES if it is balanced, otherwise NO.', 2000),
  (4, 'binary-search', 'Binary Search', 'Read n, a sorted array, and a target. Print its zero-based index, or -1.', 2000),
  (5, 'shortest-path', 'Shortest Path', 'Read an undirected unweighted graph as n m followed by m one-based edges, then source and target. Print the shortest distance, or -1.', 2000)
ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), time_limit_ms=VALUES(time_limit_ms);

INSERT INTO test_cases (id, problem_id, input_data, expected_output, is_sample) VALUES
  (1, 1, '4\n2 7 11 15\n9\n', '0 1\n', TRUE),
  (2, 1, '5\n3 2 4 8 1\n6\n', '1 2\n', FALSE),
  (3, 2, '9\n-2 1 -3 4 -1 2 1 -5 4\n', '6\n', TRUE),
  (4, 2, '5\n-8 -3 -6 -2 -5\n', '-2\n', FALSE),
  (5, 3, '([]{})\n', 'YES\n', TRUE),
  (6, 3, '([)]\n', 'NO\n', FALSE),
  (7, 4, '6\n-3 0 2 5 9 12\n5\n', '3\n', TRUE),
  (8, 4, '4\n1 3 7 10\n4\n', '-1\n', FALSE),
  (9, 5, '5 5\n1 2\n2 3\n1 4\n4 5\n3 5\n1 5\n', '2\n', TRUE),
  (10, 5, '4 2\n1 2\n3 4\n1 4\n', '-1\n', FALSE)
ON DUPLICATE KEY UPDATE expected_output=VALUES(expected_output), is_sample=VALUES(is_sample);

INSERT INTO submissions (id, user_id, problem_id, language, code, status, exec_time_ms, worker_node) VALUES
  (1, 1, 1, 'python', '', 'ACCEPTED', 12, 'worker-0'),
  (2, 1, 2, 'python', '', 'ACCEPTED', 10, 'worker-1'),
  (3, 1, 3, 'python', '', 'ACCEPTED', 9, 'worker-2'),
  (4, 2, 1, 'cpp', '', 'ACCEPTED', 4, 'worker-0'),
  (5, 2, 2, 'cpp', '', 'ACCEPTED', 5, 'worker-1'),
  (6, 2, 3, 'cpp', '', 'WRONG_ANSWER', 3, 'worker-2'),
  (7, 3, 1, 'python', '', 'ACCEPTED', 15, 'worker-0'),
  (8, 3, 4, 'python', '', 'ACCEPTED', 11, 'worker-0'),
  (9, 4, 1, 'cpp', '', 'ACCEPTED', 3, 'worker-0'),
  (10, 4, 2, 'cpp', '', 'ACCEPTED', 4, 'worker-1'),
  (11, 4, 5, 'cpp', '', 'ACCEPTED', 7, 'worker-1'),
  (12, 5, 1, 'python', '', 'ACCEPTED', 17, 'worker-0'),
  (13, 5, 3, 'python', '', 'ACCEPTED', 13, 'worker-2'),
  (14, 6, 2, 'cpp', '', 'ACCEPTED', 5, 'worker-1'),
  (15, 7, 1, 'python', '', 'ACCEPTED', 14, 'worker-0')
ON DUPLICATE KEY UPDATE status=VALUES(status), exec_time_ms=VALUES(exec_time_ms), worker_node=VALUES(worker_node);
