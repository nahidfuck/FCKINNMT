"""
import_tests.py — Імпортер тестів з JSON в базу даних
=======================================================
Використання:
    python import_tests.py                     # data/tests.json
    python import_tests.py data/my_tests.json  # свій файл

Підтримує всі типи питань: single, multiple, matching, open.

Структура JSON описана в data/tests.json.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from database import SessionLocal, engine, Base
import models

Base.metadata.create_all(bind=engine)


def import_tests(json_path: str = "data/tests.json") -> None:
    path = Path(json_path)
    if not path.exists():
        print(f"❌ Файл не знайдено: {path.resolve()}")
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

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


def _import_single_test(db, test_data: dict, stats: dict) -> None:
    # Предмет: знайти або створити
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
        db.flush()
        stats["subjects_created"] += 1
        print(f"  ➕ Новий предмет: «{subject.name}»")

    # Тест: пропускаємо якщо вже є
    if db.query(models.Test).filter(
        models.Test.title      == test_data["title"],
        models.Test.subject_id == subject.id,
    ).first():
        print(f"  ⏭  Пропущено (вже існує): «{test_data['title']}»")
        return

    test = models.Test(
        subject_id=subject.id,
        title=test_data["title"],
        description=test_data.get("description"),
        duration=test_data.get("duration", 3600),
        is_premium=test_data.get("is_premium", False),
        is_published=test_data.get("is_published", True),
        order_index=test_data.get("order_index", 0),
        reference_materials=test_data.get("reference_materials"),
    )
    db.add(test)
    db.flush()
    stats["tests"] += 1
    print(f"  ✅ Тест: «{test.title}»")

    for order_idx, q_data in enumerate(test_data.get("questions", []), start=1):
        _import_question(db, test.id, q_data, order_idx)
        stats["questions"] += 1


def _import_question(db, test_id: int, q_data: dict, order_index: int) -> None:
    """
    Створює питання. Логіка залежить від типу:

    single/multiple → варіанти йдуть в AnswerOption, correct_data посилається на їх ID
    matching        → все в content/correct_data, AnswerOption не використовується
    open            → тільки correct_data, AnswerOption не використовується
    """
    q_type = q_data.get("type", "single")

    question = models.Question(
        test_id=test_id,
        type=q_type,
        text=q_data["text"],
        image_url=q_data.get("image_url"),
        order_index=order_index,
        points=q_data.get("points", 1.0),
        explanation=q_data.get("explanation"),
    )
    db.add(question)
    db.flush()

    if q_type in ("single", "multiple"):
        _import_options_question(db, question, q_data)

    elif q_type == "matching":
        _import_matching_question(db, question, q_data)

    elif q_type == "open":
        _import_open_question(db, question, q_data)

    db.flush()


def _import_options_question(db, question: models.Question, q_data: dict) -> None:
    """
    single / multiple: зберігаємо варіанти в AnswerOption.
    correct_data посилається на ID варіантів.

    JSON для single:
      "options": [{"text":"А"},{"text":"Б"}],
      "correct_index": 1

    JSON для multiple:
      "options": [{"text":"А"},{"text":"Б"},{"text":"В"}],
      "correct_indices": [0, 2]
    """
    options = q_data.get("options", [])
    option_objects = []

    for i, opt in enumerate(options):
        obj = models.AnswerOption(
            question_id=question.id,
            text=opt["text"],
            order_index=i,
        )
        db.add(obj)
        option_objects.append(obj)

    db.flush()

    if question.type == models.QuestionType.single:
        idx = q_data.get("correct_index", 0)
        if 0 <= idx < len(option_objects):
            question.correct_data = {"answer_id": option_objects[idx].id}

    elif question.type == models.QuestionType.multiple:
        indices = q_data.get("correct_indices", [])
        ids = [option_objects[i].id for i in indices if 0 <= i < len(option_objects)]
        question.correct_data = {"answer_ids": ids}


def _import_matching_question(db, question: models.Question, q_data: dict) -> None:
    """
    matching: left і right зберігаємо в content, пари — в correct_data.

    JSON формат:
    {
      "type": "matching",
      "text": "Встановіть відповідність",
      "points": 4,
      "left":  [{"id":"1","text":"Поняття А"}, ...],
      "right": [{"id":"A","text":"Визначення 1"}, ...],
      "correct_pairs": {"1":"A","2":"C","3":"B","4":"D"}
    }
    """
    question.content = {
        "left":  q_data.get("left", []),
        "right": q_data.get("right", []),
    }
    question.correct_data = {
        "pairs": q_data.get("correct_pairs", {}),
    }


def _import_open_question(db, question: models.Question, q_data: dict) -> None:
    """
    open: зберігаємо список валідних відповідей.

    JSON формат:
    {
      "type": "open",
      "text": "Скільки коренів має рівняння x² = 4?",
      "correct_answers": ["2", "два"]
    }
    """
    question.correct_data = {
        "answers": [str(a) for a in q_data.get("correct_answers", [])],
    }


if __name__ == "__main__":
    json_file = sys.argv[1] if len(sys.argv) > 1 else "data/tests.json"
    print(f"📂 Читаємо: {json_file}\n")
    import_tests(json_file)
