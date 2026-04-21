"""
import_tests.py — Імпортер тестів з JSON в базу даних
=======================================================
Використання:
    python import_tests.py                        # читає data/tests.json
    python import_tests.py data/my_tests.json     # або свій файл

Що робить скрипт:
  1. Читає JSON-файл з масивом тестів
  2. Для кожного тесту:
     a. Знаходить предмет за slug (або створює новий)
     b. Створює тест (або оновлює якщо вже є з таким title + subject)
     c. Додає питання з варіантами відповідей та image_url
  3. Виводить звіт: скільки тестів/питань додано

Формат JSON описаний в data/tests.json
"""

import json
import sys
from pathlib import Path

# Дозволяємо запуск з будь-якої директорії
sys.path.insert(0, str(Path(__file__).parent))

from database import SessionLocal, engine, Base
import models

# Переконуємось що таблиці існують (на випадок якщо seed ще не запускали)
Base.metadata.create_all(bind=engine)


# ============================================
# ГОЛОВНА ФУНКЦІЯ
# ============================================

def import_tests(json_path: str = "data/tests.json") -> None:
    path = Path(json_path)
    if not path.exists():
        print(f"❌ Файл не знайдено: {path.resolve()}")
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # Підтримуємо як масив тестів, так і об'єкт з ключем "tests"
    tests_list = data if isinstance(data, list) else data.get("tests", [])

    if not tests_list:
        print("⚠  JSON не містить жодного тесту.")
        return

    db = SessionLocal()
    stats = {"tests": 0, "questions": 0, "subjects_created": 0}

    try:
        for test_data in tests_list:
            _import_single_test(db, test_data, stats)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"❌ Помилка під час імпорту: {e}")
        raise
    finally:
        db.close()

    print(f"\n✅ Імпорт завершено:")
    print(f"   📚 Предметів створено: {stats['subjects_created']}")
    print(f"   📝 Тестів додано:      {stats['tests']}")
    print(f"   ❓ Питань додано:      {stats['questions']}")


# ============================================
# ІМПОРТ ОДНОГО ТЕСТУ
# ============================================

def _import_single_test(db, test_data: dict, stats: dict) -> None:
    """
    Обробляє один тест з JSON і записує в БД.

    Структура test_data:
    {
      "subject_slug": "math",
      "subject_name": "Математика",
      "subject_icon": "📐",
      "title": "Назва тесту",
      "description": "Опис (опційно)",
      "duration": 600,
      "is_premium": false,
      "order_index": 1,
      "reference_materials": "<p>HTML довідник</p>",
      "questions": [...]
    }
    """
    # --- 1. Предмет: знайти або створити ---
    subject = db.query(models.Subject).filter(
        models.Subject.slug == test_data["subject_slug"]
    ).first()

    if not subject:
        subject = models.Subject(
            name=test_data.get("subject_name", test_data["subject_slug"].capitalize()),
            slug=test_data["subject_slug"],
            icon=test_data.get("subject_icon"),
        )
        db.add(subject)
        db.flush()  # отримуємо subject.id без commit
        stats["subjects_created"] += 1
        print(f"  ➕ Новий предмет: «{subject.name}»")

    # --- 2. Тест: створюємо новий ---
    # Якщо тест з такою назвою і предметом вже є — пропускаємо
    existing_test = db.query(models.Test).filter(
        models.Test.title      == test_data["title"],
        models.Test.subject_id == subject.id,
    ).first()

    if existing_test:
        print(f"  ⏭  Пропущено (вже існує): «{test_data['title']}»")
        return

    test = models.Test(
        subject_id          = subject.id,
        title               = test_data["title"],
        description         = test_data.get("description"),
        duration            = test_data.get("duration", 3600),
        is_premium          = test_data.get("is_premium", False),
        is_published        = test_data.get("is_published", True),
        order_index         = test_data.get("order_index", 0),
        reference_materials = test_data.get("reference_materials"),
    )
    db.add(test)
    db.flush()
    stats["tests"] += 1
    print(f"  ✅ Тест: «{test.title}»")

    # --- 3. Питання та варіанти відповідей ---
    for order_idx, q_data in enumerate(test_data.get("questions", []), start=1):
        _import_question(db, test.id, q_data, order_idx)
        stats["questions"] += 1


def _import_question(db, test_id: int, q_data: dict, order_index: int) -> None:
    """
    Створює одне питання з варіантами відповідей.

    Структура q_data:
    {
      "text": "Текст питання (підтримує HTML)",
      "image_url": "https://..." або null,
      "type": "single",
      "points": 1.0,
      "explanation": "Пояснення після тесту (опційно)",
      "options": [
        { "text": "Варіант А" },
        { "text": "Варіант Б" },
        ...
      ],
      "correct_index": 0   // Індекс правильного варіанту (0-based)
    }
    """
    # Крок 1: Створюємо питання без correct_answer_id (ще не знаємо ID варіантів)
    question = models.Question(
        test_id     = test_id,
        type        = q_data.get("type", "single"),
        text        = q_data["text"],
        image_url   = q_data.get("image_url"),     # None якщо відсутній
        order_index = order_index,
        points      = q_data.get("points", 1.0),
        explanation = q_data.get("explanation"),
    )
    db.add(question)
    db.flush()  # отримуємо question.id

    # Крок 2: Додаємо варіанти відповідей
    options = q_data.get("options", [])
    option_objects = []

    for i, opt_data in enumerate(options):
        opt = models.AnswerOption(
            question_id = question.id,
            text        = opt_data["text"],
            order_index = i,
        )
        db.add(opt)
        option_objects.append(opt)

    db.flush()  # отримуємо ID для кожного варіанту

    # Крок 3: Встановлюємо правильну відповідь за індексом
    correct_index = q_data.get("correct_index", 0)
    if 0 <= correct_index < len(option_objects):
        question.correct_answer_id = option_objects[correct_index].id
    else:
        print(f"    ⚠  Питання «{q_data['text'][:40]}...»: невалідний correct_index={correct_index}")

    db.flush()


# ============================================
# ТОЧКА ВХОДУ
# ============================================

if __name__ == "__main__":
    # Перший аргумент командного рядка — шлях до JSON (опційно)
    json_file = sys.argv[1] if len(sys.argv) > 1 else "data/tests.json"
    print(f"📂 Читаємо: {json_file}\n")
    import_tests(json_file)
