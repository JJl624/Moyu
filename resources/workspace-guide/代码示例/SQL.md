# SQL

声明 sql / sqlite，使用 sql.js。代码块上的下拉框选择块级、全局或内存数据库。

## 可独立执行的查询

```sql {id=0001}
SELECT 21 * 2 AS answer, sqlite_version() AS sqlite_version;
```


## 数据持久化

先运行下块建表；再将下一个块切换为全局运行，两个块才能共享同一库。若都选块级，它们各自拥有数据库，第二块会提示表不存在。

```sql {id=0002}
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, source TEXT, amount REAL);
INSERT INTO orders(source, amount) VALUES ('App', 120), ('Web', 80);
SELECT * FROM orders;
```


```sqlite {id=0003}
SELECT source, COUNT(*) AS orders, SUM(amount) AS total
FROM orders GROUP BY source;
```


块级数据库保存在本块目录；全局位于本页附属目录的code-data/SQL_GLOBAL，只在本文档内共享。SQL_GLOBAL 不随单块删除，随文档删除或手动删除而消失。内存模式每次从空库开始，运行结束关闭，不生成数据库文件。

## SQLite 语法与事务

```sql {id=0004}
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT);
BEGIN;
INSERT INTO notes(title) VALUES ('第一条');
COMMIT;
CREATE VIEW IF NOT EXISTS note_titles AS SELECT title FROM notes;
CREATE INDEX IF NOT EXISTS notes_title_idx ON notes(title);
SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%';
```

使用 SQLite 方言，查询结果按表展示并分页。行数上限控制结果预览。可从文件浏览器打开 .sqlite 文件进行只读查询和查看表、视图、索引、触发器等结构。

## 外键、触发器和窗口函数

```sql {id=0005}
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), amount INTEGER);
CREATE TABLE IF NOT EXISTS payment_log(payment_id INTEGER, amount INTEGER);
CREATE TRIGGER IF NOT EXISTS log_payment AFTER INSERT ON payments
BEGIN INSERT INTO payment_log VALUES (NEW.id, NEW.amount); END;
INSERT OR IGNORE INTO customers VALUES (1, '张三');
INSERT OR REPLACE INTO payments VALUES (1, 1, 120), (2, 1, 80);
SELECT id, amount, SUM(amount) OVER (ORDER BY id) AS running_total FROM payments;
SELECT * FROM payment_log;
```

同一次运行可显示多个查询表格。外键约束开启时，无对应客户的付款插入会报错；关闭时允许插入。触发器和视图保存在所选数据库中。

## 长表与分页

```sqlite {id=0006}
WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 200)
SELECT n, n * n AS square FROM numbers;
```

结果按页显示。把查询行数上限改为 25 后重跑，只预览前 25 行并提示截断；原表的数据不被删除。

## 设置说明

内存模式的数据库只在一次执行内存在，结束清除。块级数据库保存到本块目录；全局数据库保存到本文档的 SQL_GLOBAL，由文档内的 SQL 块共享。数据库文件名用于选择持久数据库：切换到其他文件会打开另一个数据库，旧文件保持原样。数据库文件浏览器提供只读查询和结构查看，包括表、视图、索引、触发器及系统元数据。

## 设置

在“偏好设置 → 代码 → SQL”配置该语言的运行环境与默认设置。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| 代码执行时限 | 10 | 执行时限，单位秒 |
| 环境准备时限 | 60 | 环境、包或编译准备时限，单位秒 |
| 数据库文件 | database.sqlite | 持久数据库文件名 |
| 外键约束 | 开启 | 启用外键约束 |
| 查询行数上限 | 1000 | 每个查询显示的行数上限，最多 1000 |


[代码与公式总览](../公式和代码示例.md) | [运行与数据](运行与数据.md)
